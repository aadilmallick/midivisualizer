export interface VideoExporter {
  exportVideo: (fileUri: string) => Promise<Blob>;
}
