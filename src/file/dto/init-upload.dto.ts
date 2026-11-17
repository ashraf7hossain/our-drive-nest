import { UploadVisibility } from '../upload-session';

export class InitUploadDto {
  fileName: string;
  fileSize: number;
  fileType: string;
  visibility?: UploadVisibility;
}
