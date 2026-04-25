import { createGraphFromZipBufferWithProgress, type AnalysisProgress } from "./analyzer";
import type { GraphData } from "./types";

interface AnalyzeRequest {
  type: "analyze";
  requestId: number;
  zipBuffer: ArrayBuffer;
}

interface ProgressMessage {
  type: "progress";
  requestId: number;
  progress: AnalysisProgress;
}

interface ResultMessage {
  type: "result";
  requestId: number;
  graph: GraphData;
}

interface ErrorMessage {
  type: "error";
  requestId: number;
  message: string;
}

type WorkerMessage = AnalyzeRequest;

const workerScope = self as unknown as {
  postMessage: (message: ProgressMessage | ResultMessage | ErrorMessage) => void;
  onmessage: ((event: MessageEvent<WorkerMessage>) => void) | null;
};

workerScope.onmessage = async (event: MessageEvent<WorkerMessage>) => {
  const message = event.data as WorkerMessage;
  if (message.type !== "analyze") return;

  const postProgress = (progress: AnalysisProgress): void => {
    const payload: ProgressMessage = {
      type: "progress",
      requestId: message.requestId,
      progress
    };
    workerScope.postMessage(payload);
  };

  try {
    const graph = await createGraphFromZipBufferWithProgress(message.zipBuffer, postProgress);
    const payload: ResultMessage = {
      type: "result",
      requestId: message.requestId,
      graph
    };
    workerScope.postMessage(payload);
  } catch (error) {
    const payload: ErrorMessage = {
      type: "error",
      requestId: message.requestId,
      message: error instanceof Error ? error.message : "Unknown analysis error"
    };
    workerScope.postMessage(payload);
  }
};
