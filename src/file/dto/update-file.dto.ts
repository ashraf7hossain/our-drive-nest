import { UploadVisibility } from '../upload-session';

export class UpdateFileDto {
  fileName?: string;
  visibility?: UploadVisibility;
}
