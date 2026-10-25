import { fail } from './http.ts';

export const isUuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

export function uuid(v: unknown, label = 'id'): string {
  if (!isUuid(v)) fail(400, `Invalid ${label}`);
  return v as string;
}

export function text(v: unknown, label: string, { max = 500, min = 0, optional = false } = {}): string | undefined {
  if (v === undefined || v === null) {
    if (optional) return undefined;
    if (min > 0) fail(400, `${label} is required`);
    return '';
  }
  if (typeof v !== 'string') return fail(400, `${label} must be text`);
  const s = v.trim();
  if (s.length < min) fail(400, min === 1 ? `${label} is required` : `${label} is too short`);
  if (s.length > max) fail(400, `${label} must be ${max} characters or fewer`);
  return s;
}

export function oneOf<T extends string>(v: unknown, label: string, options: readonly T[], optional = false): T | undefined {
  if (v === undefined && optional) return undefined;
  if (typeof v !== 'string' || !options.includes(v as T)) fail(400, `${label} must be one of: ${options.join(', ')}`);
  return v as T;
}

export function date(v: unknown, label: string): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) fail(400, `${label} must be a date (YYYY-MM-DD)`);
  return v as string;
}

export function bool(v: unknown, label: string): boolean | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== 'boolean') fail(400, `${label} must be true or false`);
  return v as boolean;
}

export function email(v: unknown, label = 'Email address'): string {
  const s = text(v, label, { max: 320, min: 1 })!.toLowerCase();
  if (!/^[^\s@<>()",;]+@[^\s@<>()",;]+\.[a-z]{2,}$/i.test(s)) fail(400, `${label} doesn't look right`);
  return s;
}

export function httpsUrl(v: unknown, label = 'Link'): string {
  const s = text(v, label, { max: 2000, min: 1 })!;
  let u: URL;
  try { u = new URL(s); } catch { return fail(400, `${label} must be a full web address starting with https://`); }
  if (u.protocol !== 'https:') fail(400, `${label} must start with https://`);
  if (u.username || u.password) fail(400, `${label} must not contain a username or password`);
  return u.toString();
}

// ---------------------------------------------------------------- file uploads

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/** Allowed file types: extension -> accepted MIME types. */
export const FILE_TYPES: Record<string, string[]> = {
  pdf: ['application/pdf'],
  doc: ['application/msword'],
  docx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  xls: ['application/vnd.ms-excel'],
  xlsx: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  ppt: ['application/vnd.ms-powerpoint'],
  pptx: ['application/vnd.openxmlformats-officedocument.presentationml.presentation'],
  csv: ['text/csv', 'application/vnd.ms-excel', 'text/plain'],
  txt: ['text/plain'],
  png: ['image/png'],
  jpg: ['image/jpeg'],
  jpeg: ['image/jpeg'],
  webp: ['image/webp'],
  gif: ['image/gif'],
};

export function extensionOf(name: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(name);
  return m ? m[1].toLowerCase() : '';
}

/** Checks a proposed upload before a signed upload URL is issued. Returns the canonical MIME type. */
export function checkUpload(name: string, mime: string, size: number): { ext: string; mime: string } {
  const ext = extensionOf(name);
  if (!FILE_TYPES[ext]) fail(400, `That file type isn't accepted. Allowed: ${Object.keys(FILE_TYPES).join(', ')}`);
  if (!Number.isInteger(size) || size <= 0) fail(400, 'The file is empty');
  if (size > MAX_UPLOAD_BYTES) fail(400, 'Files must be 10 MB or smaller');
  const declared = (mime || '').toLowerCase().split(';')[0].trim();
  // Browsers sometimes report an empty type for CSV and Office files; fall back to the extension's type.
  if (declared && declared !== 'application/octet-stream' && !FILE_TYPES[ext].includes(declared)) {
    fail(400, "The file's type doesn't match its extension");
  }
  return { ext, mime: FILE_TYPES[ext][0] };
}

const startsWith = (b: Uint8Array, sig: number[], offset = 0) => sig.every((x, i) => b[offset + i] === x);

/** Checks the first bytes of an uploaded file match its extension. */
export function contentMatches(ext: string, bytes: Uint8Array): boolean {
  const zip = startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]);
  const ole = startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  switch (ext) {
    case 'pdf': return startsWith(bytes, [0x25, 0x50, 0x44, 0x46]);
    case 'docx': case 'xlsx': case 'pptx': return zip;
    case 'doc': case 'xls': case 'ppt': return ole;
    case 'png': return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47]);
    case 'jpg': case 'jpeg': return startsWith(bytes, [0xff, 0xd8, 0xff]);
    case 'gif': return startsWith(bytes, [0x47, 0x49, 0x46, 0x38]);
    case 'webp': return startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8);
    case 'csv': case 'txt': {
      // Plain text: no NUL bytes and not a known binary format.
      const head = bytes.subarray(0, 4096);
      return !head.includes(0) && !zip && !ole && !startsWith(bytes, [0x25, 0x50, 0x44, 0x46]);
    }
    default: return false;
  }
}

export function safeFileName(name: string): string {
  const cleaned = name.replace(/[\\/\u0000-\u001f<>:"|?*]+/g, ' ').replace(/\s+/g, ' ').trim();
  return (cleaned || 'document').slice(0, 200);
}
