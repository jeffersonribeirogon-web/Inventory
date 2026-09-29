import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';

export interface ScanItemData {
  id?: string;
  lote?: string;
  composto?: string;
  unidade?: string;
  dataExpiracao?: string;
  scannedAt?: any;
}

export interface SavedReportItem {
  lote: string;
  composto: string;
  unidade: string;
  dataExpiracao?: string;
  scannedAt: string;
}

export interface SavedReport {
  id: string;
  title: string;
  dateFormatted: string;
  timeFormatted: string;
  totalItems: number;
  byKatame: { name: string; count: number }[];
  byLocal: { name: string; count: number }[];
  items: SavedReportItem[];
  savedAt?: any;
}

/**
 * Saves current scans as an archived inventory report in Firestore
 */
export async function saveInventoryReport(
  scans: ScanItemData[],
  customTitle?: string
): Promise<string> {
  if (scans.length === 0) {
    throw new Error('Não há leituras para gerar o relatório.');
  }

  const now = new Date();
  const dateFormatted = now.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });
  const timeFormatted = now.toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit'
  });

  const title = customTitle || `Inventário Caixas - ${dateFormatted} ${timeFormatted}`;

  // Aggregate by Katame and Local
  const katameMap: Record<string, number> = {};
  const localMap: Record<string, number> = {};

  const cleanItems: SavedReportItem[] = scans.map(s => {
    const k = s.composto || 'Desconhecido';
    const l = s.unidade || 'Desconhecido';
    katameMap[k] = (katameMap[k] || 0) + 1;
    localMap[l] = (localMap[l] || 0) + 1;

    let dateStr = '';
    if (s.scannedAt) {
      if (typeof s.scannedAt.toDate === 'function') {
        dateStr = s.scannedAt.toDate().toLocaleString('pt-BR');
      } else if (typeof s.scannedAt === 'string') {
        dateStr = s.scannedAt;
      }
    }

    return {
      lote: String(s.lote || ''),
      composto: String(s.composto || ''),
      unidade: String(s.unidade || ''),
      dataExpiracao: s.dataExpiracao || '',
      scannedAt: dateStr || now.toLocaleString('pt-BR')
    };
  });

  const byKatame = Object.keys(katameMap)
    .map(name => ({ name, count: katameMap[name] }))
    .sort((a, b) => b.count - a.count);

  const byLocal = Object.keys(localMap)
    .map(name => ({ name, count: localMap[name] }))
    .sort((a, b) => b.count - a.count);

  const docRef = await addDoc(collection(db, 'inventory_reports'), {
    title,
    dateFormatted,
    timeFormatted,
    totalItems: scans.length,
    byKatame,
    byLocal,
    items: cleanItems,
    savedAt: serverTimestamp()
  });

  return docRef.id;
}
