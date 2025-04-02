import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  FlatList,
  TouchableOpacity,
  Image,
  LayoutChangeEvent,
  ActivityIndicator,
  Dimensions,
  Modal,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { CameraView, Camera, CameraRatio } from "expo-camera";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system";
import * as ImageManipulator from 'expo-image-manipulator';

interface ComboItem {
  id: string;
  value: string;
}

interface ImageItem {
  id: string;
  uri: string;
}

interface CachedJobCodes {
  data: ComboItem[];
  lastFetched: string;
}

function applyAspectRatio(deviceWidth: number, deviceHeight: number, targetAspectRatio: number, fix = 'width') {
  if (fix === 'width') {
    const newHeight = deviceWidth / targetAspectRatio;
    return { width: deviceWidth, height: Math.round(newHeight) };
  } else {
    const newWidth = deviceHeight * targetAspectRatio;
    return { width: Math.round(newWidth), height: deviceHeight };
  }
}

export default function App() {
  const [jobCodes, setJobCodes] = useState<ComboItem[]>([]);
  const [lastFetched, setLastFetched] = useState<string | null>(null);
  const [isFetching, setIsFetching] = useState<boolean>(false);
  const [searchJobCode, setSearchJobCode] = useState<string>("");
  const [selectedJobCode, setSelectedJobCode] = useState<{ value: string; id: string } | null>(null);
  const [isJobCodeDropdownOpen, setIsJobCodeDropdownOpen] = useState<boolean>(false);
  const [jobCodeInputY, setJobCodeInputY] = useState<number>(0);
  const jobCodeInputRef = useRef<TextInput>(null);

  const fileTypes: ComboItem[] = [
    { id: "job-survey", value: "Job Survey" },
    { id: "job-progress", value: "Job Progress" },
    { id: "job-completion", value: "Job Completion" },
    { id: "freight-received", value: "Freight Received" },
    { id: "freight-shipped", value: "Freight Shipped" },
  ];
  const [selectedFileType, setSelectedFileType] = useState<{ value: string; id: string } | null>(null);
  const [isFileTypeDropdownOpen, setIsFileTypeDropdownOpen] = useState<boolean>(false);
  const [fileTypeButtonY, setFileTypeButtonY] = useState<number>(0);
  const fileTypeButtonRef = useRef<View>(null);

  const [images, setImages] = useState<ImageItem[]>([]);
  const [showCamera, setShowCamera] = useState<boolean>(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const cameraRef = useRef<CameraView | null>(null);
  const [selectedSize, setSelectedSize] = useState<string | null>(null);
  const [previewRatio, setPreviewRatio] = useState('4:3');
  const [isProcessing, setIsProcessing] = useState<boolean>(false);

  // Load job codes and images on mount
  useEffect(() => {
    const loadData = async () => {
      setIsFetching(true);
      try {
        const response = await fetch("https://gandpfnv4dev.ngrok.io/api/erp/jobcode");
        console.log("jobcode res", response);
        if (!response.ok) {
          throw new Error(`HTTP error! Status: ${response.status}`);
        }
        const data: ComboItem[] = (await response.json()).Payload.map((item: any) => ({
          id: item.Code,
          value: item.Name,
        }))
          .sort((a: any, b: any) => a.value.localeCompare(b.value))
          .map((jc: any, index: number) => ({ ...jc, key: index }));
        const timestamp = new Date().toISOString();
        setJobCodes(data);
        setLastFetched(timestamp);
        await AsyncStorage.setItem("jobCodes", JSON.stringify({ data, lastFetched: timestamp }));



        const gnpNROY0 = data.find((item) => item.id === "GNP-NROY0");
        if (gnpNROY0) {
          setSelectedJobCode(gnpNROY0);
        }
        setSelectedFileType({ id: "job-progress", value: "Job Progress" });



      } catch (error) {
        console.error("Fetch error:", error);
        const cachedJobCodes = await AsyncStorage.getItem("jobCodes");
        if (cachedJobCodes) {
          const { data, lastFetched }: CachedJobCodes = JSON.parse(cachedJobCodes);
          setJobCodes(data);
          setLastFetched(lastFetched);
        } else {
          console.log("No cache, using fallback data");
          const fallbackData: ComboItem[] = [];
          const timestamp = "Never";
          setJobCodes(fallbackData);
          setLastFetched(timestamp);
          await AsyncStorage.setItem("jobCodes", JSON.stringify({ data: fallbackData, lastFetched: timestamp }));
        }
      } finally {
        setIsFetching(false);
      }

      // Load images from AsyncStorage
      try {
        const storedImages = await AsyncStorage.getItem("storedImages");
        console.log("Loading - Raw storedImages from AsyncStorage:", storedImages);
        if (storedImages) {
          const parsedImages: ImageItem[] = JSON.parse(storedImages);
          console.log("Loading - Parsed images:", parsedImages);
          setImages(parsedImages);
        } else {
          console.log("Loading - No stored images found in AsyncStorage");
          setImages([]);
        }
      } catch (error) {
        console.error("Loading - Error loading images from AsyncStorage:", error);
        setImages([]);
      }
    };
    loadData();
  }, []);

  // Auto-save images to AsyncStorage with debounce
  useEffect(() => {
    const saveImages = async () => {
      try {
        console.log("Auto-saving - Images to save:", images);
        await AsyncStorage.setItem("storedImages", JSON.stringify(images));
        const savedData = await AsyncStorage.getItem("storedImages");
        console.log("Auto-saving - Verified saved data in AsyncStorage:", savedData);
      } catch (error) {
        console.error("Auto-saving - Error saving images to AsyncStorage:", error);
      }
    };

    const timeoutId = setTimeout(() => {
      if (images.length > 0) {
        saveImages();
      } else {
        AsyncStorage.removeItem("storedImages").then(() =>
          console.log("Auto-saving - Cleared storedImages as array is empty")
        );
      }
    }, 500);

    return () => clearTimeout(timeoutId);
  }, [images]);

  const blobFolderPath = useMemo(() => {
    if (!selectedJobCode || !selectedFileType) { return null; }
    let path = `ALL CUSTOMERS`;
    path += `|${selectedJobCode.id}`;
    path += `|${selectedFileType.id}`;
    return path;
  }, [selectedJobCode, selectedFileType]);

  const filteredJobCodes = jobCodes.filter((option) =>
    option.value.toLowerCase().includes(searchJobCode.toLowerCase())
  );

  const handleJobCodeLayout = (event: LayoutChangeEvent) => {
    setJobCodeInputY(event.nativeEvent.layout.y + event.nativeEvent.layout.height);
  };

  const handleFileTypeLayout = (event: LayoutChangeEvent) => {
    setFileTypeButtonY(event.nativeEvent.layout.y + event.nativeEvent.layout.height);
  };

  const openCamera = async () => {
    const { status } = await Camera.requestCameraPermissionsAsync();
    if (status === "granted") {
      setShowCamera(true);
    } else {
      console.log("Camera permission denied");
    }
  };

  const takePicture = async () => {
    if (cameraRef.current) {
      try {

        await new Promise((resolve) => setTimeout(resolve, 250));

        const photo = await cameraRef.current.takePictureAsync({ quality: 0.5 });
        if (!photo) {
          console.error('No photo captured');
          return;
        }

        const persistentUri = `${FileSystem.documentDirectory}camera_${Date.now()}.jpg`;
        await FileSystem.moveAsync({
          from: photo.uri,
          to: persistentUri,
        });

        // Update state with the new image
        const newImage = { id: Date.now().toString(), uri: persistentUri };
        setImages((prev) => [newImage, ...prev]);

      } catch (error) {
        console.error('Error taking, rotating, or moving photo:', error);
      }
    }
  };

  const pickImages = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      console.log("Media library permission denied");
      return;
    }

    try {
      setIsProcessing(true);

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images", "livePhotos"],
        allowsMultipleSelection: true,
        selectionLimit: 50,
        quality: 1,
      });

      if (!result.canceled && result.assets) {
        const newImages = await Promise.all(
          result.assets.map(async (asset) => {
            const persistentUri = `${FileSystem.documentDirectory}library_${Date.now()}_${Math.random().toString(36).substring(2, 11)}.jpg`;
            await FileSystem.copyAsync({
              from: asset.uri,
              to: persistentUri,
            });
            return {
              id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
              uri: persistentUri,
            };
          })
        );
        setImages((prev) => [...newImages, ...prev]);
      }
    } catch (error) {
      console.error("Error picking or copying images:", error);
    } finally {
      setIsProcessing(false);
    }
  };

  const deleteImage = async (id: string) => {
    const imageToDelete = images.find((img) => img.id === id);
    if (imageToDelete) {
      try {
        console.log("Deleting file at", imageToDelete.uri);
        await FileSystem.deleteAsync(imageToDelete.uri);
      } catch (error) {
        console.error(`Error deleting file at ${imageToDelete.uri}:`, error);
      }
    }
    setImages((prev) => prev.filter((image) => image.id !== id));
  };

  const openPreview = (uri: string) => {
    setPreviewImage(uri);
  };

  const closePreview = () => {
    setPreviewImage(null);
  };

  // Retry helper function
  const retry = async (
    fn: () => Promise<any>,
    operation: string,
    maxRetries: number,
    delayMs: number,
    fileId?: string
  ) => {
    let lastError;
    for (let i = 0; i < maxRetries; i++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        console.log(`Retry ${i + 1}/${maxRetries} failed for ${operation}${fileId ? ` (${fileId})` : ""}:`, error);
        if (i < maxRetries - 1) await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
    throw lastError;
  };

  // Chunk array helper
  const chunkArray = (array: any[], size: number) =>
    Array.from({ length: Math.ceil(array.length / size) }, (_, i) =>
      array.slice(i * size, i * size + size)
    );

  // Calculate file size from base64
  const getFileSize = async (uri: string): Promise<number> => {
    const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
    return Math.round((base64.length * 3) / 4);
  };

  const handleUpload = async () => {
    if (images.length === 0 || !selectedJobCode || !selectedFileType) {
      console.log("Missing job code, file type, or images to upload");
      return;
    }

    setIsUploading(true);
    setUploadProgress(0);

    const baseUrl = "https://gandpfnv4dev.ngrok.io";
    const totalImages = images.length;
    let uploadedCount = 0;
    const chunkSize = 5;

    // Get next index from server
    let nextIndex = -1;
    try {
      const resNextIndex = await retry(
        () =>
          fetch(`${baseUrl}/api/jobmedia/new`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              JobCode: selectedJobCode.id,
              Type: selectedFileType.id,
              Subtype: null,
              NumImages: totalImages,
            }),
          }),
        "get file name",
        5,
        1000
      );
      const data = await resNextIndex.json();
      if (!data?.Success) throw new Error(data?.Errors?.[0]?.Message ?? "Unknown error");
      nextIndex = data?.Payload?.[0]?.NewIndex;
    } catch (error) {
      console.error("Failed to get next index:", error);
      setIsUploading(false);
      return;
    }

    const fileTypeMap: { [key: string]: string } = {
      "job-survey": "JS",
      "job-progress": "JP",
      "job-completion": "JC",
      "freight-received": "FR",
      "freight-shipped": "FS",
    };

    let chunkIndex = 0;
    for (const chunk of chunkArray(images, chunkSize)) {
      const results = await Promise.allSettled(
        chunk.map(async (image: ImageItem, index: number) => {
          try {
            const fileNameBase =
              selectedFileType.id === "freight-received" || selectedFileType.id === "freight-shipped"
                ? ""
                : `${selectedJobCode.id}-${fileTypeMap[selectedFileType.id]}-`;
            const imageIndex = nextIndex + chunkIndex * chunkSize + index;
            const fileExt = image.uri.split(".").pop();
            const computedFileName = `${fileNameBase}${imageIndex}.${fileExt}`;

            // Read file as base64
            const fileContent = await FileSystem.readAsStringAsync(image.uri, {
              encoding: FileSystem.EncodingType.Base64,
            });
            const fileSize = await getFileSize(image.uri);

            // Upload to blob storage with base64 string as body
            const resPostBlob = await retry(
              () =>
                fetch(
                  `${baseUrl}/storage/upload?dynamicfilename=JobMedia&container=app-uploads&blobName=${encodeURIComponent(`${blobFolderPath}|${computedFileName}`)}&postLogs=true&base64=true`,
                  {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/base64",
                    },
                    body: fileContent,
                  }
                ),
              "file upload",
              5,
              1000,
              image.id
            );
            const blobData = await resPostBlob.json();
            if (!blobData?.Success) throw new Error(blobData?.Errors?.[0]?.Message ?? "Unknown error");

            const blobPath = blobData.blobPath?.split("/").filter(Boolean).slice(1).join("/") || computedFileName;

            // Post to dbo.JobMedia
            const resPostSQL = await retry(
              () =>
                fetch(`${baseUrl}/api/jobmedia`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    JobCode: selectedJobCode.id,
                    ContainerName: "app-uploads",
                    BlobPath: blobPath,
                    Type: selectedFileType.id,
                    Subtype: null,
                    FileExt: fileExt,
                    EmployeeId: "NULL",
                    Summary: computedFileName.split(".").slice(0, -1).join("."),
                    Size: fileSize,
                  }),
                }),
              "database post",
              5,
              1000,
              image.id
            );
            const sqlData = await resPostSQL.json();
            if (!sqlData?.Success) throw new Error(sqlData?.Errors?.[0]?.Message ?? "Unknown error");

            // Success: Remove from state and filesystem
            await FileSystem.deleteAsync(image.uri);
            setImages((prev) => prev.filter((img) => img.id !== image.id));
            uploadedCount++;
            setUploadProgress(uploadedCount / totalImages);

            return image;
          } catch (error) {
            console.error(`Failed to upload image ${image.id}:`, error);
            return Promise.reject(error);
          }
        })
      );

      chunkIndex++;
    }

    setIsUploading(false);
    if (uploadedCount === totalImages) {
      setUploadProgress(1);
      console.log("All images uploaded successfully");
    } else {
      console.log(`Uploaded ${uploadedCount} out of ${totalImages} images`);
    }
  };

  const onCameraReady = async () => {
    const desiredRatio = 16 / 9;
    const perm = await Camera.requestCameraPermissionsAsync();
    if (perm.status !== 'granted') {
      console.log('Camera permission denied');
      return;
    }

    const availableSizes = await cameraRef?.current?.getAvailablePictureSizesAsync();

    // Calculate aspect ratios for available sizes
    const sizesWithRatio = availableSizes?.map((size) => {
      const [width, height] = size.split('x').map(Number);
      return { size, ratio: width / height };
    });

    // Find sizes matching the desired ratio (with tolerance)
    const matchingSizes = sizesWithRatio?.filter(
      ({ ratio }) => Math.abs(ratio - desiredRatio) < 0.1
    );

    if (matchingSizes && matchingSizes.length > 0) {
      // Select the largest size by area (highest resolution)
      const largestSize = matchingSizes?.reduce((prev, current) => {
        const [w1, h1] = prev.size.split('x').map(Number);
        const [w2, h2] = current.size.split('x').map(Number);
        return w1 * h1 > w2 * h2 ? prev : current;
      });

      setSelectedSize(largestSize?.size || null);

      // Set the preview ratio to match the selected size
      const [width, height] = largestSize.size.split('x').map(Number);
      const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
      const divisor = gcd(width, height);
      setPreviewRatio(`${width / divisor}:${height / divisor}`);
    } else {
      console.log('No 4:3 sizes available; consider a fallback ratio.');
    }
    console.log("camera ready");
  };

  useEffect(() => {

  }, []);

  const { width: deviceWidth, height: deviceHeight } = Dimensions.get('window');
  const targetAspectRatio = 3 / 4;
  const { width, height } = applyAspectRatio(deviceWidth, deviceHeight, targetAspectRatio, 'width');

  return (
    <View style={styles.rootContainer}>
      {showCamera ? (
        
        <View style={styles.cameraContainer}>
          <CameraView
            style={{ width, height }}
            facing={"back"}
            autofocus="on"
            ref={cameraRef}
            pictureSize={selectedSize || undefined}
            ratio={previewRatio as CameraRatio}
            onCameraReady={onCameraReady}
            responsiveOrientationWhenOrientationLocked={true}
          />
          <View style={styles.cameraButtonContainer}>
            <TouchableOpacity style={styles.cameraButton} onPress={() => setShowCamera(false)}>
              <Text style={styles.cameraButtonText}>Done</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.cameraButton} onPress={takePicture}>
              <Text style={styles.cameraButtonText}>Take Photo</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <View style={styles.container}>
          <View style={styles.headerRow}>
            <Text style={styles.label}>Select Job Code</Text>
            {isFetching ? (
              <ActivityIndicator size="small" color="#666" style={styles.spinner} />
            ) : (
              lastFetched && (
                <Text style={styles.timestamp}>
                  Last updated {new Date(lastFetched).toLocaleString()}
                </Text>
              )
            )}
          </View>
          <TextInput
            ref={jobCodeInputRef}
            style={styles.input}
            value={searchJobCode || selectedJobCode?.value || ""}
            onChangeText={(text) => {
              setSearchJobCode(text);
              setIsJobCodeDropdownOpen(true);
              if (text && selectedJobCode) setSelectedJobCode(null);
            }}
            onFocus={() => setIsJobCodeDropdownOpen(true)}
            onBlur={() => {
              if (!searchJobCode) setIsJobCodeDropdownOpen(false);
            }}
            onLayout={handleJobCodeLayout}
            placeholder="Search job codes..."
          />
          {isJobCodeDropdownOpen && (
            <FlatList
              data={filteredJobCodes}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.option}
                  onPress={() => {
                    setSelectedJobCode(item);
                    setSearchJobCode("");
                    setIsJobCodeDropdownOpen(false);
                    jobCodeInputRef.current?.blur();
                  }}
                >
                  <Text>{item.value}</Text>
                </TouchableOpacity>
              )}
              style={[styles.dropdown, { top: jobCodeInputY }]}
            />
          )}

          <View style={styles.headerRow}>
            <Text style={styles.label}>Select File Type</Text>
          </View>
          <TouchableOpacity
            ref={fileTypeButtonRef}
            style={styles.input}
            onPress={() => {
              if (!selectedJobCode) {
                return;
              }
              setIsFileTypeDropdownOpen(!isFileTypeDropdownOpen);
            }}
            onLayout={handleFileTypeLayout}
          >
            <Text style={[styles.dropdownButtonText, !selectedJobCode && styles.disabledDropdownText]}>
              {selectedFileType?.value || "Select a file type"}
            </Text>
          </TouchableOpacity>
          {isFileTypeDropdownOpen && (
            <FlatList
              data={fileTypes}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.option}
                  onPress={() => {
                    setSelectedFileType(item);
                    setIsFileTypeDropdownOpen(false);
                  }}
                >
                  <Text>{item.value}</Text>
                </TouchableOpacity>
              )}
              style={[styles.dropdown, { top: fileTypeButtonY }]}
            />
          )}

          <View style={styles.buttonContainer}>
            <TouchableOpacity
              style={[styles.customButton, (!blobFolderPath || isUploading) && styles.disabledButton]}
              onPress={pickImages}
              disabled={!blobFolderPath || isUploading}
            >
              <Text style={styles.buttonText}>Add Existing Photos</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.customButton, (!blobFolderPath || isUploading) && styles.disabledButton]}
              onPress={openCamera}
              disabled={!blobFolderPath || isUploading}
            >
              <Text style={styles.buttonText}>Take Photos</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.customButton, (isUploading || !blobFolderPath || images.length === 0) && styles.disabledButton]}
              onPress={handleUpload}
              disabled={isUploading || images.length === 0}
            >
              <Text style={styles.buttonText}>Upload{images?.length > 0 ? ` (${images.length})` : ""}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.customButton, (isUploading || !blobFolderPath || images.length === 0) && styles.disabledButton]}
              onPress={() => setImages([])}
              disabled={isUploading || images.length === 0}
            >
              <Text style={styles.buttonText}>Remove All</Text>
            </TouchableOpacity>
          </View>

          {isUploading && (
            <View style={styles.progressContainer}>
              <Text style={styles.progressText}>Uploading...</Text>
              <View style={styles.progressBarBackground}>
                <View
                  style={[
                    styles.progressBarFill,
                    { width: `${uploadProgress * 100}%` },
                  ]}
                />
              </View>
            </View>
          )}

          {isProcessing && (
            <View style={{ flexGrow: 1, justifyContent: "center", alignItems: "center" }}>
              <ActivityIndicator size="large" color="#666" style={styles.spinner} />
            </View>
          )}

          <View style={styles.gridWrapper}>
            <FlatList
              data={images?.length > 20 ? images.slice(0, 20) : images}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <View style={styles.imageContainer}>
                  <TouchableOpacity onPress={() => openPreview(item.uri)}>
                    <Image source={{ uri: item.uri }} style={styles.image} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.deleteButton}
                    onPress={() => deleteImage(item.id)}
                  >
                    <Text style={styles.deleteButtonText}>X</Text>
                  </TouchableOpacity>
                </View>
              )}
              numColumns={2}
              contentContainerStyle={styles.gridContent}
              initialScrollIndex={0}
            />
          </View>

          <Modal
            visible={!!previewImage}
            transparent={true}
            animationType="fade"
            onRequestClose={closePreview}
          >
            <TouchableOpacity style={styles.modalOverlay} onPress={closePreview}>
              <Image
                source={{ uri: previewImage || "" }}
                style={styles.fullImage}
                resizeMode="contain"
              />
            </TouchableOpacity>
          </Modal>
        </View>
      )}
    </View>
  );
}

const { height, width } = Dimensions.get("window");

const styles = StyleSheet.create({
  rootContainer: {
    flex: 1,
    backgroundColor: "#f0f0f0",
  },
  container: {
    flex: 1,
    padding: 20,
    paddingTop: 100,
    backgroundColor: "#f0f0f0",
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  label: {
    fontSize: 18,
    fontWeight: "bold",
  },
  timestamp: {
    fontSize: 12,
    color: "#666",
  },
  spinner: {
    marginLeft: 10,
  },
  input: {
    borderWidth: 1,
    borderColor: "#ccc",
    padding: 10,
    borderRadius: 5,
    marginBottom: 10,
    justifyContent: "center",
  },
  dropdown: {
    position: "absolute",
    left: 20,
    right: 20,
    maxHeight: 150,
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 5,
    backgroundColor: "#fff",
    zIndex: 10,
  },
  option: {
    padding: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  dropdownButtonText: {
    fontSize: 16,
    color: "#000",
  },
  disabledDropdownText: {
    color: "rgb(150, 150, 150)",
  },
  buttonContainer: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 20,
  },
  customButton: {
    backgroundColor: "#007AFF",
    paddingVertical: 10,
    paddingHorizontal: 15,
    borderRadius: 5,
    alignItems: "center",
    justifyContent: "center",
    flex: 1,
    marginHorizontal: 5,
  },
  disabledButton: {
    backgroundColor: "#999",
  },
  buttonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "bold",
  },
  progressContainer: {
    marginBottom: 20,
    alignItems: "center",
  },
  progressText: {
    marginBottom: 5,
    fontSize: 16,
  },
  progressBarBackground: {
    width: "80%",
    height: 10,
    backgroundColor: "#e0e0e0",
    borderRadius: 5,
    overflow: "hidden",
  },
  progressBarFill: {
    height: "100%",
    backgroundColor: "#007AFF",
    borderRadius: 5,
  },
  gridWrapper: {
    display: "flex",
    flex: 1,
    justifyContent: "flex-start",
    paddingTop: 20,
  },
  gridContent: {
    display: "flex",
    justifyContent: "flex-start",
    alignItems: "flex-start",
    flexGrow: 1,
  },
  imageContainer: {
    position: "relative",
    margin: 5,
  },
  image: {
    width: 150,
    height: 150,
    borderRadius: 5,
  },
  deleteButton: {
    position: "absolute",
    top: 5,
    right: 5,
    backgroundColor: "rgba(255, 0, 0, 0.7)",
    borderRadius: 12,
    width: 24,
    height: 24,
    justifyContent: "center",
    alignItems: "center",
  },
  deleteButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "bold",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.8)",
    justifyContent: "center",
    alignItems: "center",
  },
  fullImage: {
    width: width * 0.9,
    height: height * 0.7,
  },
  cameraContainer: {
    flex: 1,
    width: "100%",
    position: "relative",
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "black",
    display: "flex"
  },
  cameraButtonContainer: {
    position: "absolute",
    bottom: 50,
    left: 0,
    right: 0,
    flexDirection: "row",
    justifyContent: "space-around",
    paddingHorizontal: 20,
  },
  cameraButton: {
    padding: 15,
    backgroundColor: "rgba(255, 255, 255, 0.8)",
    borderRadius: 5,
  },
  cameraButtonText: {
    fontSize: 16,
    color: "#000",
    textAlign: "center",
  },
  camera: {
    height: height,
    width: width,
  }
});