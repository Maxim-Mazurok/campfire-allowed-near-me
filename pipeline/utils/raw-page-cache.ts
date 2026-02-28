import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

interface RawPageCacheEntry {
  finalUrl: string;
  html: string;
}

interface RawPageCacheOptions {
  filePath: string;
  ttlMs: number;
}

interface RawPageArchiveEntry extends RawPageCacheEntry {
  fetchedAt: string;
}

interface RawPageArchive {
  schemaVersion: number;
  pages: Record<string, RawPageArchiveEntry>;
}

const RAW_PAGE_ARCHIVE_SCHEMA_VERSION = 1;

export class RawPageCache {
  private readonly filePath: string;

  private readonly ttlMs: number;

  private readonly now: () => number;

  private loaded = false;

  private loadPromise: Promise<void> | null = null;

  private pages = new Map<string, RawPageArchiveEntry>();

  private writeQueue: Promise<void> = Promise.resolve();

  constructor(options: RawPageCacheOptions, now: () => number = Date.now) {
    this.filePath = options.filePath;
    this.ttlMs = options.ttlMs;
    this.now = now;
  }

  async get(url: string): Promise<RawPageCacheEntry | null> {
    await this.loadIfNeeded();

    const cached = this.pages.get(url);
    if (!cached) {
      return null;
    }

    if (!this.isFresh(cached.fetchedAt)) {
      this.pages.delete(url);
      await this.persist();
      return null;
    }

    return {
      finalUrl: cached.finalUrl,
      html: cached.html
    };
  }

  async set(url: string, entry: RawPageCacheEntry): Promise<void> {
    await this.loadIfNeeded();

    this.pages.set(url, {
      fetchedAt: new Date(this.now()).toISOString(),
      finalUrl: entry.finalUrl,
      html: entry.html
    });

    await this.persist();
  }

  /**
   * Returns all pages currently in the cache (including expired entries that
   * were added during this session). Useful for exporting the cache contents
   * as a raw pages archive after a scraping session.
   */
  async exportAllPages(): Promise<Record<string, RawPageArchiveEntry>> {
    await this.loadIfNeeded();
    return Object.fromEntries(this.pages.entries());
  }

  private async loadIfNeeded(): Promise<void> {
    if (this.loaded) {
      return;
    }

    if (!this.loadPromise) {
      this.loadPromise = this.load();
    }

    await this.loadPromise;
  }

  private async load(): Promise<void> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<RawPageArchive>;

      if (
        parsed.schemaVersion !== RAW_PAGE_ARCHIVE_SCHEMA_VERSION ||
        !parsed.pages ||
        typeof parsed.pages !== "object"
      ) {
        return;
      }

      for (const [url, value] of Object.entries(parsed.pages)) {
        if (
          typeof value?.fetchedAt !== "string" ||
          typeof value?.finalUrl !== "string" ||
          typeof value?.html !== "string"
        ) {
          continue;
        }

        this.pages.set(url, {
          fetchedAt: value.fetchedAt,
          finalUrl: value.finalUrl,
          html: value.html
        });
      }

      if (this.pruneExpiredEntries()) {
        await this.persist();
      }
    } catch {
      // Ignore missing/invalid cache files and treat cache as empty.
    } finally {
      this.loaded = true;
    }
  }

  private isFresh(fetchedAt: string): boolean {
    const fetchedAtMs = Date.parse(fetchedAt);
    if (Number.isNaN(fetchedAtMs)) {
      return false;
    }

    return this.now() - fetchedAtMs <= this.ttlMs;
  }

  private pruneExpiredEntries(): boolean {
    const initialSize = this.pages.size;
    for (const [url, value] of this.pages.entries()) {
      if (!this.isFresh(value.fetchedAt)) {
        this.pages.delete(url);
      }
    }

    return this.pages.size !== initialSize;
  }

  private async persist(): Promise<void> {
    this.writeQueue = this.writeQueue.then(async () => {
      await mkdir(dirname(this.filePath), { recursive: true });

      const archive: RawPageArchive = {
        schemaVersion: RAW_PAGE_ARCHIVE_SCHEMA_VERSION,
        pages: Object.fromEntries(this.pages.entries())
      };

      await writeFile(this.filePath, JSON.stringify(archive, null, 2), "utf8");
    });

    try {
      await this.writeQueue;
    } catch {
      this.writeQueue = Promise.resolve();
    }
  }
}
