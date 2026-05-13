// Abstract base used as the DI token. Switching to S3 / MinIO later = write a
// new class that extends this, swap the `useClass` in StorageModule. Nothing
// else in the codebase needs to change because consumers depend on this type,
// not the concrete implementation.
export interface SaveOptions {
  // Subdirectory inside the storage root (e.g. "posts", "avatars").
  prefix: string;
  // File extension without the leading dot (e.g. "webp", "png").
  ext: string;
}

export abstract class StorageService {
  // Persists the buffer and returns the storage key (e.g. "posts/<uuid>.webp").
  // The key is what gets stored in the DB — never the absolute path.
  abstract save(buffer: Buffer, opts: SaveOptions): Promise<string>;

  // Removes the file at the given key. No-op (does not throw) if missing.
  abstract delete(key: string): Promise<void>;

  // Builds the public URL clients can use to fetch the file. Null in → null out.
  abstract url(key: string | null): string | null;
}
