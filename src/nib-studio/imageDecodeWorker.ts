// The image decode worker: turns TIFF files into RGBA off the page's thread.
import { decodeImageRequest, type ImageDecodeRequest } from '../common/image/imageDecodeRequest.js';

interface DecodeWorkerScope {
    postMessage(message: unknown, transfer: Transferable[]): void;
    onmessage: ((event: MessageEvent<ImageDecodeRequest>) => void) | null;
}

const scope = self as unknown as DecodeWorkerScope;

scope.onmessage = (event) => {
    const response = decodeImageRequest(event.data);
    scope.postMessage(response, response.ok ? [response.pixels] : []);
};
