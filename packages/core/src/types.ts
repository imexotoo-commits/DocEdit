/** All PDF coordinates in this library are PDF user space: origin bottom-left, unit = 1/72 inch, y grows upward, ignoring page /Rotate. */
export interface Rect { x: number; y: number; width: number; height: number }

export type Pdf = Uint8Array;

export interface PageInfo { index: number; width: number; height: number; rotation: 0 | 90 | 180 | 270 }

export interface Metadata {
  title?: string; author?: string; subject?: string; keywords?: string[];
  creator?: string; producer?: string; creationDate?: Date; modificationDate?: Date;
}

export interface DocumentInfo { pageCount: number; pages: PageInfo[]; metadata: Metadata; formFieldCount: number }

/** RGB 0..1 */
export type Color = [number, number, number];
