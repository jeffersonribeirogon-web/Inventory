import localforage from 'localforage';

export const offlineQueue = localforage.createInstance({ name: 'katame-offline-queue' });

export interface QueuedImage {
  id: string;
  type: 'caixa' | 'manta';
  imageBase64: string;
  timestamp: number;
}

export async function addToQueue(type: 'caixa' | 'manta', imageBase64: string) {
  const id = Date.now().toString() + Math.random().toString(36).substr(2, 5);
  const item: QueuedImage = {
    id,
    type,
    imageBase64,
    timestamp: Date.now()
  };
  await offlineQueue.setItem(id, item);
  return id;
}

export async function getQueue(): Promise<QueuedImage[]> {
  const items: QueuedImage[] = [];
  await offlineQueue.iterate((value: QueuedImage) => {
    items.push(value);
  });
  return items.sort((a, b) => a.timestamp - b.timestamp);
}

export async function removeFromQueue(id: string) {
  await offlineQueue.removeItem(id);
}
