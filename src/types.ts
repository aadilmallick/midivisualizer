export interface VideoExportOptions {
  durationSeconds?: number;
}

export interface VideoExporter {
  exportVideo: (fileUri: string, options?: VideoExportOptions) => Promise<Blob>;
}
