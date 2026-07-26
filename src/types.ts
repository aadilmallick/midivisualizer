export interface VideoExportOptions {
  audioBlob?: Blob;
  durationSeconds?: number;
}

export interface VideoExporter {
  exportVideo: (fileUri: string, options?: VideoExportOptions) => Promise<Blob>;
}
