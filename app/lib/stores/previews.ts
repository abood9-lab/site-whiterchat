import type { WebContainer } from '@webcontainer/api';
import { atom } from 'nanostores';
import { subscribeDaytonaPreview } from './runtime';

export interface PreviewInfo {
  port: number;
  ready: boolean;
  baseUrl: string;
  source?: 'webcontainer' | 'daytona';
}

export class PreviewsStore {
  #availablePreviews = new Map<string, PreviewInfo>();
  #webcontainer: Promise<WebContainer>;

  previews = atom<PreviewInfo[]>([]);

  constructor(webcontainerPromise: Promise<WebContainer>) {
    this.#webcontainer = webcontainerPromise;

    this.#init();
  }

  addExternalPreview(preview: PreviewInfo) {
    const key = `daytona:${preview.port}`;
    this.#availablePreviews.set(key, { ...preview, source: 'daytona' });
    this.#syncPreviewsArray();
  }

  #syncPreviewsArray() {
    this.previews.set(Array.from(this.#availablePreviews.values()));
  }

  async #init() {
    subscribeDaytonaPreview((preview) => {
      this.addExternalPreview(preview);
    });

    const webcontainer = await this.#webcontainer;

    webcontainer.on('port', (port, type, url) => {
      const key = `wc:${port}`;
      let previewInfo = this.#availablePreviews.get(key);

      if (type === 'close' && previewInfo) {
        this.#availablePreviews.delete(key);
        this.#syncPreviewsArray();
        return;
      }

      if (!previewInfo) {
        previewInfo = { port, ready: type === 'open', baseUrl: url, source: 'webcontainer' };
        this.#availablePreviews.set(key, previewInfo);
      } else {
        previewInfo.ready = type === 'open';
        previewInfo.baseUrl = url;
      }

      this.#syncPreviewsArray();
    });
  }
}
