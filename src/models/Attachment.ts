export interface AttachmentRef {
  completionState?:import('../parser/completion.js').CompletionState;
  fileId:string; fileName:string;
  sourceType:'announcement'|'board'|'assignment'|'ubfile'|'resource'|'folder'|'unknown';
  parentId?:string;courseId:string;mimeType?:string;sizeBytes?:number;downloadable:boolean;
}
