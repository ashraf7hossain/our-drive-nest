export type UploadVisibility = 'private' | 'public';
export type UploadStatus = 'in_progress' | 'completed';

export interface UploadSession {
  uploadId: string;
  userId: number;
  fileName: string;
  fileType: string;
  fileSize: number;
  visibility: UploadVisibility;
  offset: number;
  tempPath: string;
  finalPath: string;
  publicPath: string;
  status: UploadStatus;
  fileId?: number;
  createdAt: string;
}
