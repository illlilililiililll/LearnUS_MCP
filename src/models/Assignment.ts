import type { AttachmentRef } from './Attachment.js';
export interface Assignment {
  cmid: number;
  url: string;
  title?: string;
  description?: string;
  submissionStatus?: string;
  gradingStatus?: string;
  dueDate?: string;
  lastModified?: string;
  timeRemaining?: string;
  extraFields: {label: string; value: string}[];
  warnings: string[];
  attachments?: AttachmentRef[];
}
