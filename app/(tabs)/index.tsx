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
  AppState,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { CameraView, Camera, CameraRatio } from "expo-camera";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system";
import * as TaskManager from "expo-task-manager";
import * as Notifications from "expo-notifications";

// Interfaces for type safety
interface ComboItem {
  id: string;
  value: string;
  key?: number;
}

interface ImageItem {
  id: string;
  uri: string;
}

interface CachedJobCodes {
  data: ComboItem[];
  lastFetched: string;
}

interface UploadTaskData {
  taskId: string;
  images: ImageItem[];
  selectedJobCode: ComboItem;
  selectedFileType: ComboItem;
  baseUrl: string;
  fileTypeMap: { [key: string]: string };
  uploadedCount: number;
}

interface UploadProgress {
  completed: number;
  total: number;
  timestamp: number;
}

// Update progress in AsyncStorage
// const updateUploadProgress = async (taskId: string, completed: number, total: number) => {
//   await AsyncStorage.setItem(
//     `upload-progress-${taskId}`,
//     JSON.stringify({ completed, total, timestamp: Date.now() } as UploadProgress)
//   );
// };

// Define the background task (must be in global scope)
// const UPLOAD_TASK = "background-upload";
// TaskManager.defineTask(UPLOAD_TASK, async ({ data, error }: TaskManager.TaskManagerTaskBody<UploadTaskData>) => {
//   if (error) {
//     console.error("Background task error:", error);
//     await notifyUserOfInterruption(data.taskId, "Task failed due to an error");
//     return;
//   }

//   const { taskId, images, selectedJobCode, selectedFileType, baseUrl, fileTypeMap } = data;
//   let uploadedCount = data.uploadedCount || 0;
//   const totalImages = images.length;

//   // Get next index from server
//   let nextIndex = -1;
//   try {
//     const resNextIndex = await retry(
//       () =>
//         fetch(`${baseUrl}/api/jobmedia/new`, {
//           method: "POST",
//           headers: { "Content-Type": "application/json" },
//           body: JSON.stringify({
//             JobCode: selectedJobCode.id,
//             Type: selectedFileType.id,
//             Subtype: null,
//             NumImages: totalImages,
//           }),
//         }),
//       "get file name",
//       5,
//       1000
//     );
//     const data = await resNextIndex.json();
//     if (!data?.Success) throw new Error(data?.Errors?.[0]?.Message ?? "Unknown error");
//     nextIndex = data?.Payload?.[0]?.NewIndex;
//   } catch (error) {
//     console.error("Failed to get next index:", error);
//     return;
//   }

//   try {
//     for (let i = uploadedCount; i < images.length; i++) {
//       const image = images[i];
//       const result = await uploadSingleImage(
//         image,
//         selectedJobCode,
//         selectedFileType,
//         baseUrl,
//         fileTypeMap,
//         nextIndex + i,
//       );
//       if (result.success) {
//         uploadedCount++;
//         await updateUploadProgress(taskId, uploadedCount, totalImages);
//       } else {
//         throw new Error(result.error);
//       }
//     }

//     await AsyncStorage.removeItem(`upload-progress-${taskId}`);
//     await AsyncStorage.removeItem(`upload-data-${taskId}`);
//     console.log(`Task ${taskId} completed: ${uploadedCount}/${totalImages}`);
//   } catch (err) {
//     console.error(`Task ${taskId} interrupted:`, err);
//     await notifyUserOfInterruption(taskId, "Upload paused due to interruption");
//   }
// });

// Notify user via push notification
// const notifyUserOfInterruption = async (taskId: string, reason: string) => {
//   const progress: UploadProgress = JSON.parse(await AsyncStorage.getItem(`upload-progress-${taskId}`) || "{}");
//   if (progress.completed < progress.total) {
//     const token = await getPushToken();
//     if (token) {
//       await sendPushNotification(token, taskId, reason, progress.completed, progress.total);
//     }
//   }
// };

// // Get Expo push token
// const getPushToken = async (): Promise<string | null> => {
//   const { status } = await Notifications.requestPermissionsAsync();
//   if (status !== "granted") return null;
//   const token = (await Notifications.getExpoPushTokenAsync()).data;
//   return token;
// };

// // Send push notification
// const sendPushNotification = async (
//   token: string,
//   taskId: string,
//   reason: string,
//   completed: number,
//   total: number
// ) => {
//   const message = {
//     to: token,
//     sound: "default",
//     title: "Upload Paused",
//     body: `${reason}. ${completed}/${total} uploaded. Open the app to resume.`,
//     data: { taskId },
//   };
//   await fetch("https://exp.host/--/api/v2/push/send", {
//     method: "POST",
//     headers: { "Content-Type": "application/json" },
//     body: JSON.stringify(message),
//   });
// };

// Single image upload logic
const uploadSingleImage = async (
  image: ImageItem,
  selectedJobCode: ComboItem,
  selectedFileType: ComboItem,
  baseUrl: string,
  fileTypeMap: { [key: string]: string },
  imageIndex: number,
): Promise<{ success: boolean; error?: string }> => {
  const fileNameBase =
    selectedFileType.id === "freight-received" || selectedFileType.id === "freight-shipped"
      ? ""
      : `${selectedJobCode.id}-${fileTypeMap[selectedFileType.id]}-`;
  const fileExt = image.uri.split(".").pop() || "jpg";
  const computedFileName = `${fileNameBase}${imageIndex}.${fileExt}`;
  const blobFolderPath = `ALL CUSTOMERS|${selectedJobCode.id}|${selectedFileType.id}`;

  const fileContent = await FileSystem.readAsStringAsync(image.uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  let fileSize = Math.round((fileContent.length * 3) / 4);

  const resPostBlob = await retry(
    () =>
      fetch(
        `${baseUrl}/storage/upload?dynamicfilename=JobMedia&container=app-uploads&blobName=${encodeURIComponent(`${blobFolderPath}|${computedFileName}`)}&postLogs=true&base64=true`,
        {
          method: "POST",
          headers: { "Content-Type": "application/base64" },
          body: fileContent,
        }
      ),
    "file upload",
    5,
    1000,
    image.id
  );
  const blobData = await resPostBlob.json();
  if (!blobData?.Success) return { success: false, error: blobData?.Errors?.[0]?.Message ?? "Unknown error" };

  if (blobData.fileSize) {
    fileSize = blobData.fileSize;
  }

  const blobPath = blobData.blobPath?.split("/").filter(Boolean).slice(1).join("/") || computedFileName;

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
  if (!sqlData?.Success) return { success: false, error: sqlData?.Errors?.[0]?.Message ?? "Unknown error" };

  await FileSystem.deleteAsync(image.uri);
  return { success: true };
};

// Retry helper
const retry = async (
  fn: () => Promise<Response>,
  operation: string,
  maxRetries: number,
  delayMs: number,
  fileId?: string
): Promise<Response> => {
  let lastError: Error | undefined;
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      console.log(`Retry ${i + 1}/${maxRetries} failed for ${operation}${fileId ? ` (${fileId})` : ""}:`, error);
      if (i < maxRetries - 1) await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
};

// Get next index
const getNextIndex = async (
  baseUrl: string,
  selectedJobCode: ComboItem,
  selectedFileType: ComboItem,
  numImages: number
): Promise<number> => {
  const res = await fetch(`${baseUrl}/api/jobmedia/new`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      JobCode: selectedJobCode.id,
      Type: selectedFileType.id,
      Subtype: null,
      NumImages: numImages,
    }),
  });
  const data = await res.json();
  if (!data?.Success) throw new Error(data?.Errors?.[0]?.Message ?? "Unknown error");
  return data.Payload[0].NewIndex;
};

// Main App component
export default function App() {
  const [jobCodes, setJobCodes] = useState<ComboItem[]>([]);
  const [lastFetched, setLastFetched] = useState<string | null>(null);
  const [isFetching, setIsFetching] = useState<boolean>(false);
  const [searchJobCode, setSearchJobCode] = useState<string>("");
  const [selectedJobCode, setSelectedJobCode] = useState<ComboItem | null>(null);
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
  const [selectedFileType, setSelectedFileType] = useState<ComboItem | null>(null);
  const [isFileTypeDropdownOpen, setIsFileTypeDropdownOpen] = useState<boolean>(false);
  const [fileTypeButtonY, setFileTypeButtonY] = useState<number>(0);
  const fileTypeButtonRef = useRef<View>(null);
  const [images, setImages] = useState<ImageItem[]>([]);
  const [showCamera, setShowCamera] = useState<boolean>(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const cameraRef = useRef<CameraView>(null);
  const [selectedSize, setSelectedSize] = useState<string | null>(null);
  const [previewRatio, setPreviewRatio] = useState<string>("4:3");
  const [isProcessing, setIsProcessing] = useState<boolean>(false);

  const fileTypeMap: { [key: string]: string } = {
    "job-survey": "JS",
    "job-progress": "JP",
    "job-completion": "JC",
    "freight-received": "FR",
    "freight-shipped": "FS",
  };

  // useEffect(() => {
  //   const checkInterruptedUploads = async () => {
  //     const keys = await AsyncStorage.getAllKeys();
  //     const uploadKeys = keys.filter((key) => key.startsWith("upload-progress-"));
  //     for (const key of uploadKeys) {
  //       const progress = JSON.parse(await AsyncStorage.getItem(key) || "{}") as UploadProgress;
  //       if (progress.completed < progress.total) {
  //         console.log(`Found interrupted upload: ${key}`);
  //         await notifyUserOfInterruption(key.replace("upload-progress-", ""), "Upload paused");
  //       }
  //     }
  //   };

  //   checkInterruptedUploads();
  //   const subscription = AppState.addEventListener("change", (state) => {
  //     if (state === "active") checkInterruptedUploads();
  //   });
  //   return () => subscription.remove();
  // }, []);

  const handleUpload = async () => {
    if (images.length === 0 || !selectedJobCode || !selectedFileType) {
      console.log("Missing job code, file type, or images to upload");
      return;
    }

    setIsUploading(true);
    setUploadProgress(0);

    const totalImages = images.length;
    const baseUrl = "https://gandpfnv4dev.ngrok.io";

    // Initialize the task data so upload can continue in the background
    // const taskId = `upload-${Date.now()}`;
    // const taskData: UploadTaskData = {
    //   taskId,
    //   images: [...images],
    //   selectedJobCode,
    //   selectedFileType,
    //   baseUrl,
    //   fileTypeMap,
    //   uploadedCount: 0,
    // };
    // await AsyncStorage.setItem(`upload-data-${taskId}`, JSON.stringify(taskData));

    // Update the task data so background task knows where we left off
    // await updateUploadProgress(taskId, 0, totalImages);

    // Get next index from server
    const nextIndex = await getNextIndex(baseUrl, selectedJobCode, selectedFileType, totalImages);

    // Start the foreground upload; background takes over if app suspends
    let uploadedCount = 0;
    try {
      for (let i = 0; i < images.length; i++) {

        console.log("starting upload of image", i + 1, "of", images.length);

        const result = await uploadSingleImage(
          images[i],
          selectedJobCode,
          selectedFileType,
          baseUrl,
          fileTypeMap,
          nextIndex + i,
        );

        if (result.success) {
          uploadedCount++;
          setImages((prev) => prev.filter((img) => img.id !== images[i].id));
          setUploadProgress(uploadedCount / totalImages);

          // Update the task data so background task knows where we left off
          // await updateUploadProgress(taskId, uploadedCount, totalImages);
        } else {
          throw new Error(result.error);
        }
      }

      // await AsyncStorage.removeItem(`upload-data-${taskId}`);
      // await AsyncStorage.removeItem(`upload-progress-${taskId}`);

      console.log("All images uploaded in foreground");
    } catch (error) {
      console.error("Foreground upload interrupted:", error);
      // Background task will continue from uploadedCount if app is suspended
    } finally {
      setIsUploading(false);
    }
  };

  const applyAspectRatio = (
    deviceWidth: number,
    deviceHeight: number,
    targetAspectRatio: number,
    fix: "width" | "height" = "width"
  ): { width: number; height: number } => {
    if (fix === "width") {
      const newHeight = deviceWidth / targetAspectRatio;
      return { width: deviceWidth, height: Math.round(newHeight) };
    } else {
      const newWidth = deviceHeight * targetAspectRatio;
      return { width: Math.round(newWidth), height: deviceHeight };
    }
  };

  useEffect(() => {
    const loadData = async () => {
      setIsFetching(true);
      try {
        const response = await fetch("https://gandpfnv4dev.ngrok.io/api/erp/jobcode");
        if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
        const data: ComboItem[] = (await response.json()).Payload.map((item: any) => ({
          id: item.Code,
          value: item.Name,
        }))
          .sort((a: any, b: any) => a.value.localeCompare(b.value))
          .map((jc: any, index: any) => ({ ...jc, key: index }));
        const timestamp = new Date().toISOString();
        setJobCodes(data);
        setLastFetched(timestamp);
        await AsyncStorage.setItem("jobCodes", JSON.stringify({ data, lastFetched: timestamp } as CachedJobCodes));

        // Load saved selections
        const savedJobCode = await AsyncStorage.getItem("selectedJobCode");
        const savedFileType = await AsyncStorage.getItem("selectedFileType");

        console.log("Saved job code:", savedJobCode);
        console.log("Saved file type:", savedFileType);

        if (savedJobCode) {
          setSelectedJobCode(JSON.parse(savedJobCode));

          if (savedFileType) {
            setSelectedFileType(JSON.parse(savedFileType));
          }
        }

      } catch (error) {
        console.error("Fetch error:", error);
        const cachedJobCodes = await AsyncStorage.getItem("jobCodes");
        if (cachedJobCodes) {
          const { data, lastFetched } = JSON.parse(cachedJobCodes) as CachedJobCodes;
          setJobCodes(data);
          setLastFetched(lastFetched);
        } else {
          const fallbackData: ComboItem[] = [];
          const timestamp = "Never";
          setJobCodes(fallbackData);
          setLastFetched(timestamp);
          await AsyncStorage.setItem("jobCodes", JSON.stringify({ data: fallbackData, lastFetched: timestamp }));
        }
      } finally {
        setIsFetching(false);
      }

      const storedImages = await AsyncStorage.getItem("storedImages");
      if (storedImages) setImages(JSON.parse(storedImages) as ImageItem[]);
    };
    loadData();
  }, []);

  useEffect(() => {
    const saveSelections = async () => {
      if (selectedJobCode) {
        await AsyncStorage.setItem("selectedJobCode", JSON.stringify(selectedJobCode));
      }
      if (selectedFileType) {
        await AsyncStorage.setItem("selectedFileType", JSON.stringify(selectedFileType));
      }
    };
    saveSelections();
  }, [selectedJobCode, selectedFileType]);

  useEffect(() => {
    const saveImages = async () => {
      await AsyncStorage.setItem("storedImages", JSON.stringify(images));
    };
    const timeoutId = setTimeout(() => {
      if (images.length > 0) saveImages();
      else AsyncStorage.removeItem("storedImages");
    }, 500);
    return () => clearTimeout(timeoutId);
  }, [images]);

  const takePicture = async () => {
    if (cameraRef.current) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.5 });
      if (!photo) return;
      const persistentUri = `${FileSystem.documentDirectory}camera_${Date.now()}.jpg`;
      await FileSystem.moveAsync({ from: photo.uri, to: persistentUri });
      setImages((prev) => [{ id: Date.now().toString(), uri: persistentUri }, ...prev]);
    }
  };

  const pickImages = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") return;
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
          await FileSystem.copyAsync({ from: asset.uri, to: persistentUri });
          return { id: Date.now().toString() + Math.random().toString(36).substr(2, 9), uri: persistentUri };
        })
      );
      setImages((prev) => [...newImages, ...prev]);
    }
    setIsProcessing(false);
  };

  const deleteImage = async (id: string) => {
    const imageToDelete = images.find((img) => img.id === id);
    if (imageToDelete) await FileSystem.deleteAsync(imageToDelete.uri);
    setImages((prev) => prev.filter((image) => image.id !== id));
  };

  const openPreview = (uri: string) => setPreviewImage(uri);
  const closePreview = () => setPreviewImage(null);

  const blobFolderPath = useMemo(() => {
    if (!selectedJobCode || !selectedFileType) return null;
    return `ALL CUSTOMERS|${selectedJobCode.id}|${selectedFileType.id}`;
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
    if (status === "granted") setShowCamera(true);
  };

  const onCameraReady = async () => {
    const desiredRatio = 16 / 9;
    const perm = await Camera.requestCameraPermissionsAsync();
    if (perm.status !== "granted") return;
    const availableSizes = await cameraRef.current?.getAvailablePictureSizesAsync();
    const sizesWithRatio = availableSizes?.map((size) => {
      const [width, height] = size.split("x").map(Number);
      return { size, ratio: width / height };
    });
    const matchingSizes = sizesWithRatio?.filter(
      ({ ratio }) => Math.abs(ratio - desiredRatio) < 0.1
    );
    if (matchingSizes && matchingSizes.length > 0) {
      const largestSize = matchingSizes.reduce((prev, current) => {
        const [w1, h1] = prev.size.split("x").map(Number);
        const [w2, h2] = current.size.split("x").map(Number);
        return w1 * h1 > w2 * h2 ? prev : current;
      });
      setSelectedSize(largestSize?.size || null);
      const [width, height] = largestSize.size.split("x").map(Number);
      const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
      const divisor = gcd(width, height);
      setPreviewRatio(`${width / divisor}:${height / divisor}`);
    }
  };

  const onJobCodeFocus = async () => {
    if (isJobCodeDropdownOpen || searchJobCode) {
      console.log("Job code dropdown already open");
      return;
    }
    setIsJobCodeDropdownOpen(true);
    setSearchJobCode("");
    setSelectedJobCode(null);
    setSelectedFileType(null);
    await AsyncStorage.removeItem("selectedJobCode");
    await AsyncStorage.removeItem("selectedFileType");
  };

  const { width: deviceWidth, height: deviceHeight } = Dimensions.get("window");
  const targetAspectRatio = 3 / 4;
  const { width, height } = applyAspectRatio(deviceWidth, deviceHeight, targetAspectRatio, "width");

  return (
    <View style={styles.rootContainer}>
      {showCamera ? (
        <View style={styles.cameraContainer}>
          <CameraView
            style={{ width, height }}
            facing="back"
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
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            autoComplete="off"
            autoFocus={false}
            selectTextOnFocus={true}
            clearButtonMode="always"
            clearTextOnFocus={true}
            value={searchJobCode || selectedJobCode?.value || ""}
            onChangeText={(text) => {
              setSearchJobCode(text);
              setIsJobCodeDropdownOpen(true);
              if (text && selectedJobCode) {
                setSelectedJobCode(null);
              }
            }}
            onFocus={onJobCodeFocus}
            onLayout={handleJobCodeLayout}
            placeholder="Search job codes..."
          />
          {isJobCodeDropdownOpen && (
            <FlatList
              data={filteredJobCodes}
              keyExtractor={(item) => item.id}
              keyboardShouldPersistTaps="always"
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
              if (!selectedJobCode) return;
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

          {!isUploading && (
            <>
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
                  style={[styles.uploadButton, (isUploading || !blobFolderPath || images.length === 0) && styles.disabledButton]}
                  onPress={handleUpload}
                  disabled={isUploading || images.length === 0}
                >
                  <Text style={styles.buttonText}>Upload{images.length > 0 ? ` (${images.length})` : ""}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.removeAllButton, (isUploading || !blobFolderPath || images.length === 0) && styles.disabledButton]}
                  onPress={() => setImages([])}
                  disabled={isUploading || images.length === 0}
                >
                  <Text style={styles.buttonText}>Remove All</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.gridWrapper}>
                <FlatList
                  data={images.length > 20 ? images.slice(0, 20) : images}
                  keyExtractor={(item) => item.id}
                  renderItem={({ item }) => (
                    <View style={styles.imageContainer}>
                      <TouchableOpacity onPress={() => openPreview(item.uri)}>
                        <Image source={{ uri: item.uri }} style={styles.image} />
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.deleteButton} onPress={() => deleteImage(item.id)}>
                        <Text style={styles.deleteButtonText}>X</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                  numColumns={2}
                  contentContainerStyle={styles.gridContent}
                />
              </View>
            </>
          )}

          {isUploading && (
            <View style={styles.progressContainer}>
              <View style={{ display: "flex", flexDirection: "row", gap: 5 }}>
                <ActivityIndicator size="small" color="#666" style={styles.spinner} />
                <Text style={styles.progressText}>Uploading...</Text>
              </View>
              <View style={styles.progressBarBackground}>
                <View style={[styles.progressBarFill, { width: `${uploadProgress * 100}%` }]} />
              </View>
            </View>
          )}

          {isProcessing && (
            <View style={{ flexGrow: 1, justifyContent: "center", alignItems: "center" }}>
              <ActivityIndicator size="large" color="#666" style={styles.spinner} />
            </View>
          )}

          <Modal
            visible={!!previewImage}
            transparent={true}
            animationType="fade"
            onRequestClose={closePreview}
          >
            <TouchableOpacity style={styles.modalOverlay} onPress={closePreview}>
              <Image source={{ uri: previewImage || "" }} style={styles.fullImage} resizeMode="contain" />
            </TouchableOpacity>
          </Modal>
        </View>
      )}
    </View>
  );
}

const { height, width } = Dimensions.get("window");
const styles = StyleSheet.create({
  rootContainer: { flex: 1, backgroundColor: "#f0f0f0" },
  container: { flex: 1, padding: 20, paddingTop: 100, backgroundColor: "#f0f0f0" },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  label: { fontSize: 18, fontWeight: "bold" },
  timestamp: { fontSize: 12, color: "#666" },
  spinner: { marginLeft: 10 },
  input: { borderWidth: 1, borderColor: "#ccc", padding: 10, borderRadius: 5, marginBottom: 10, justifyContent: "center" },
  dropdown: { position: "absolute", left: 20, right: 20, maxHeight: 200, borderWidth: 1, borderColor: "#ccc", borderRadius: 5, backgroundColor: "#fff", zIndex: 10 },
  option: { padding: 10, borderBottomWidth: 1, borderBottomColor: "#eee" },
  dropdownButtonText: { fontSize: 16, color: "#000" },
  disabledDropdownText: { color: "rgb(150, 150, 150)" },
  buttonContainer: { flexDirection: "row", justifyContent: "space-between", marginBottom: 20 },
  customButton: { backgroundColor: "#007AFF", paddingVertical: 10, paddingHorizontal: 15, borderRadius: 5, alignItems: "center", justifyContent: "center", flex: 1, marginHorizontal: 5 },
  uploadButton: { backgroundColor: "#008f3d", paddingVertical: 10, paddingHorizontal: 15, borderRadius: 5, alignItems: "center", justifyContent: "center", flex: 1, marginHorizontal: 5 },
  removeAllButton: { backgroundColor: "#b42b29", paddingVertical: 10, paddingHorizontal: 15, borderRadius: 5, alignItems: "center", justifyContent: "center", flex: 1, marginHorizontal: 5 },
  disabledButton: { backgroundColor: "#999" },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "bold", textAlign: "center" },
  progressContainer: { display: "flex", flexDirection: "column", gap: 7, marginBottom: 20, alignItems: "center" },
  progressText: { marginBottom: 5, fontSize: 16 },
  progressBarBackground: { width: "80%", height: 10, backgroundColor: "#e0e0e0", borderRadius: 5, overflow: "hidden" },
  progressBarFill: { height: "100%", backgroundColor: "#007AFF", borderRadius: 5 },
  gridWrapper: { display: "flex", flex: 1, justifyContent: "flex-start", paddingTop: 20 },
  gridContent: { display: "flex", justifyContent: "flex-start", alignItems: "flex-start", flexGrow: 1 },
  imageContainer: { position: "relative", margin: 5 },
  image: { width: 150, height: 150, borderRadius: 5 },
  deleteButton: { position: "absolute", top: 5, right: 5, backgroundColor: "rgba(255, 0, 0, 0.7)", borderRadius: 12, width: 24, height: 24, justifyContent: "center", alignItems: "center" },
  deleteButtonText: { color: "#fff", fontSize: 16, fontWeight: "bold" },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0, 0, 0, 0.8)", justifyContent: "center", alignItems: "center" },
  fullImage: { width: width * 0.9, height: height * 0.7 },
  cameraContainer: { flex: 1, width: "100%", position: "relative", justifyContent: "center", alignItems: "center", backgroundColor: "black", display: "flex" },
  cameraButtonContainer: { position: "absolute", bottom: 50, left: 0, right: 0, flexDirection: "row", justifyContent: "space-around", paddingHorizontal: 20 },
  cameraButton: { padding: 15, backgroundColor: "rgba(255, 255, 255, 0.8)", borderRadius: 5 },
  cameraButtonText: { fontSize: 16, color: "#000", textAlign: "center" },
});