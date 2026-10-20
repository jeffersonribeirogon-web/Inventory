import * as XLSX from 'xlsx';
import { doc, setDoc, deleteDoc, onSnapshot, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';

export interface ExcelCaixaItem {
  composto: string;
  lote: string; // 7 dígitos normalizados para cruzar com o código de barras
  peso: string | number;
  pesoReal: string | number;
}

export interface ExcelBaseMeta {
  fileName: string;
  uploadedAt: string;
  uploadedBy?: string;
  itemsCount: number;
}

const LOCAL_STORAGE_ITEMS_KEY = 'katame_excel_base_caixas';
const LOCAL_STORAGE_META_KEY = 'katame_excel_base_caixas_meta';
const FIRESTORE_DOC_PATH = 'excel_inventory_base/current_active_base';

/**
 * Extrai os últimos 7 dígitos de um código de barras de 12 dígitos.
 * Remove formatações como .0 geradas pelo Excel.
 */
export function extract7Digits(barcode: string): string {
  const clean = String(barcode || '').trim().replace(/\.0+$/, '');
  return clean.length >= 7 ? clean.slice(-7) : clean.padStart(7, '0');
}

/**
 * Detecta a plataforma de onde o arquivo está sendo enviado
 */
export function detectPlatform(): string {
  if (typeof window === 'undefined') return 'Plataforma Web';
  const width = window.innerWidth;
  const ua = navigator.userAgent.toLowerCase();
  
  if (/ipad|tablet|(android(?!.*mobile))/i.test(ua)) {
    return 'Tablet';
  } else if (/iphone|ipod|android.*mobile/i.test(ua) || width < 768) {
    return 'Celular (Mobile)';
  } else {
    return 'PC (Desktop / Web)';
  }
}

/**
/**
 * Normaliza strings para comparação (remove acentos e espaços extras)
 */
function cleanStr(val: any): string {
  return String(val ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase();
}

/**
 * Lê e converte qualquer arquivo Excel (.xlsx, .xls ou .csv) em itens padronizados
 */
export async function parseExcelFile(file: File): Promise<{ items: ExcelCaixaItem[]; meta: ExcelBaseMeta }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = new Uint8Array(evt.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        
        if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
          throw new Error("A planilha não possui abas válidas.");
        }

        // Procura a aba com maior quantidade de linhas úteis
        let bestSheetName = workbook.SheetNames[0];
        let bestRows: any[][] = [];

        for (const sheetName of workbook.SheetNames) {
          const ws = workbook.Sheets[sheetName];
          if (!ws) continue;
          const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
          if (rows.length > bestRows.length) {
            bestRows = rows;
            bestSheetName = sheetName;
          }
        }

        const rawRows = bestRows;
        if (rawRows.length === 0) {
          throw new Error("A planilha selecionada está vazia.");
        }

        // Identifica linha de cabeçalho nos primeiros 30 registros
        let headerRowIndex = -1;
        let colComposto = -1;
        let colLote = -1;
        let colPeso = -1;
        let colPesoReal = -1;

        for (let r = 0; r < Math.min(rawRows.length, 30); r++) {
          const row = rawRows[r];
          if (!row || !Array.isArray(row)) continue;

          let foundLote = -1;
          let foundComp = -1;

          row.forEach((cell, idx) => {
            const str = cleanStr(cell);
            if (
              str.includes('LOTE') || str.includes('CODIGO') || str.includes('BARCODE') || 
              str.includes('ETIQUETA') || str.includes('NUMERO') || str.includes('SERIE') ||
              str === 'LOT' || str === 'ID' || str === 'TAG' || str === 'NS'
            ) {
              foundLote = idx;
            }
            if (
              str.includes('COMPOSTO') || str.includes('KATAME') || str.includes('PRODUTO') || 
              str.includes('MATERIAL') || str.includes('PROD') || str.includes('COMP') || 
              str.includes('ITEM') || str.includes('DESCRICAO') || str.includes('DESC')
            ) {
              foundComp = idx;
            }
          });

          if (foundLote !== -1 && foundComp !== -1) {
            headerRowIndex = r;
            colLote = foundLote;
            colComposto = foundComp;

            // Busca colunas de peso
            row.forEach((cell, idx) => {
              const str = cleanStr(cell);
              if (str.includes('REAL') || str.includes('BALANCA') || str.includes('PESADO')) {
                colPesoReal = idx;
              } else if (str.includes('PESO') || str.includes('TEORICO') || str.includes('KG') || str.includes('LIQUIDO')) {
                colPeso = idx;
              }
            });
            break;
          }
        }

        // Se encontrou apenas Lote mas não Composto (ou vice-versa)
        if (headerRowIndex === -1) {
          for (let r = 0; r < Math.min(rawRows.length, 30); r++) {
            const row = rawRows[r];
            if (!row || !Array.isArray(row)) continue;
            row.forEach((cell, idx) => {
              const str = cleanStr(cell);
              if (str.includes('LOTE') || str.includes('CODIGO') || str.includes('BARCODE')) {
                headerRowIndex = r;
                colLote = idx;
              }
            });
            if (headerRowIndex !== -1) {
              // Composto assume a coluna 0 ou 1 adjacente
              colComposto = colLote === 0 ? 1 : 0;
              break;
            }
          }
        }

        // Fallback inteligente: se não encontrou cabeçalho nomeado, busca coluna com números
        if (headerRowIndex === -1 && rawRows.length > 0) {
          headerRowIndex = 0;
          colComposto = 0;
          colLote = 1;
          colPeso = 2;
          colPesoReal = 3;
        }

        const items: ExcelCaixaItem[] = [];
        for (let r = headerRowIndex + 1; r < rawRows.length; r++) {
          const row = rawRows[r];
          if (!row || !Array.isArray(row)) continue;

          const rawLote = String(row[colLote] ?? '').trim();
          if (!rawLote) continue;

          const cleanLote = rawLote.replace(/\.0+$/, '').trim();
          const cleanUpper = cleanLote.toUpperCase();
          if (!cleanLote || cleanUpper.includes('LOTE') || cleanUpper.includes('CODIGO')) continue;

          // Normaliza lote para 7 dígitos (ex: 1013061 ou com zero 0929006)
          const lote7 = cleanLote.length >= 7 ? cleanLote.slice(-7) : cleanLote.padStart(7, '0');
          const composto = String(row[colComposto] ?? '').trim().toUpperCase() || 'REBK';
          const peso = colPeso !== -1 ? String(row[colPeso] ?? '').trim() : '';
          const pesoReal = colPesoReal !== -1 ? String(row[colPesoReal] ?? '').trim() : '';

          items.push({
            lote: lote7,
            composto,
            peso,
            pesoReal
          });
        }

        if (items.length === 0) {
          throw new Error("Nenhuma linha com lote válido foi encontrada na planilha. Verifique as colunas de LOTE e COMPOSTO.");
        }

        const meta: ExcelBaseMeta = {
          fileName: file.name,
          uploadedAt: new Date().toISOString(),
          uploadedBy: detectPlatform(),
          itemsCount: items.length
        };

        resolve({ items, meta });
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error("Falha ao ler o arquivo selecionado."));
    reader.readAsArrayBuffer(file);
  });
}

/**
 * Cruza um código de barras escaneado (com 12 ou 7 dígitos) com os itens da base Excel
 */
export function matchBarcodeWithExcel(cleanBarcode: string, excelBase: ExcelCaixaItem[]): ExcelCaixaItem | undefined {
  if (!cleanBarcode || !excelBase || excelBase.length === 0) return undefined;

  const lote7 = extract7Digits(cleanBarcode);
  const lote7SemZeros = lote7.replace(/^0+/, '');
  const barcodeTrim = cleanBarcode.trim();

  return excelBase.find((item) => {
    const itemLote = String(item.lote || '').trim();
    const itemLoteSemZeros = itemLote.replace(/^0+/, '');

    return (
      itemLote === lote7 ||
      (itemLoteSemZeros && itemLoteSemZeros === lote7SemZeros) ||
      barcodeTrim.endsWith(itemLote) ||
      itemLote === barcodeTrim
    );
  });
}

/**
 * Salva no localStorage para suporte total offline em tablets/celulares
 */
export function saveExcelBaseLocally(items: ExcelCaixaItem[], meta: ExcelBaseMeta) {
  try {
    localStorage.setItem(LOCAL_STORAGE_ITEMS_KEY, JSON.stringify(items));
    localStorage.setItem(LOCAL_STORAGE_META_KEY, JSON.stringify(meta));
  } catch (err) {
    console.warn("Aviso de cota do localStorage:", err);
  }
}

/**
 * Recupera do cache local
 */
export function getExcelBaseLocally(): { items: ExcelCaixaItem[]; meta: ExcelBaseMeta | null } {
  try {
    const rawItems = localStorage.getItem(LOCAL_STORAGE_ITEMS_KEY);
    const rawMeta = localStorage.getItem(LOCAL_STORAGE_META_KEY);
    const items = rawItems ? JSON.parse(rawItems) : [];
    const meta = rawMeta ? JSON.parse(rawMeta) : null;
    return { items, meta };
  } catch {
    return { items: [], meta: null };
  }
}

/**
 * Limpa o cache local
 */
export function clearExcelBaseLocally() {
  try {
    localStorage.removeItem(LOCAL_STORAGE_ITEMS_KEY);
    localStorage.removeItem(LOCAL_STORAGE_META_KEY);
  } catch (e) {
    console.warn(e);
  }
}

/**
 * Salva a base no Firestore para sincronização automática entre todas as plataformas (PC, Celular, Tablet na Rede)
 */
export async function saveExcelBaseToCloud(items: ExcelCaixaItem[], meta: ExcelBaseMeta): Promise<void> {
  const baseDocRef = doc(db, 'excel_inventory_base', 'current_active_base');
  
  // Compacta os itens para economia de banda e respeitar o limite de 1MB do Firestore
  const compactItems = items.map(it => ({
    lote: it.lote,
    composto: it.composto,
    peso: it.peso || '',
    pesoReal: it.pesoReal || ''
  }));

  await setDoc(baseDocRef, {
    fileName: meta.fileName,
    uploadedAt: meta.uploadedAt,
    uploadedBy: meta.uploadedBy || detectPlatform(),
    itemsCount: items.length,
    items: compactItems,
    updatedAt: serverTimestamp()
  });
}

/**
 * Remove a base do Firestore (atualiza todos os dispositivos em tempo real)
 */
export async function clearExcelBaseFromCloud(): Promise<void> {
  const baseDocRef = doc(db, 'excel_inventory_base', 'current_active_base');
  await deleteDoc(baseDocRef);
}

/**
 * Escuta atualizações da base em tempo real no Firestore
 */
export function listenToCloudExcelBase(
  callback: (data: { items: ExcelCaixaItem[]; meta: ExcelBaseMeta } | null) => void
) {
  const baseDocRef = doc(db, 'excel_inventory_base', 'current_active_base');
  return onSnapshot(
    baseDocRef,
    (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        const rawItems = (data.items || []) as any[];
        const items: ExcelCaixaItem[] = rawItems.map(it => ({
          lote: String(it.lote || it.l || '').trim(),
          composto: String(it.composto || it.c || '').trim(),
          peso: it.peso ?? it.p ?? '',
          pesoReal: it.pesoReal ?? it.pr ?? ''
        }));

        const meta: ExcelBaseMeta = {
          fileName: data.fileName || 'base_katame.xlsx',
          uploadedAt: data.uploadedAt || new Date().toISOString(),
          uploadedBy: data.uploadedBy || 'Nuvem',
          itemsCount: items.length
        };
        // Mantém cache local atualizado automaticamente para uso offline
        saveExcelBaseLocally(items, meta);
        callback({ items, meta });
      } else {
        clearExcelBaseLocally();
        callback(null);
      }
    },
    (err) => {
      console.warn("Aviso Firestore excel_inventory_base:", err);
    }
  );
}

/**
 * Gera e baixa uma planilha modelo de exemplo com a estrutura perfeita (composto, lote, peso, peso real)
 */
export function downloadSampleExcelTemplate() {
  const sampleData = [
    {
      "COMPOSTO": "REBK",
      "LOTE": "1013061",
      "PESO": 25.5,
      "PESO REAL": 25.5
    },
    {
      "COMPOSTO": "RETBK978",
      "LOTE": "0929006",
      "PESO": 24.8,
      "PESO REAL": 24.9
    },
    {
      "COMPOSTO": "RESW",
      "LOTE": "1140023",
      "PESO": 25.0,
      "PESO REAL": 25.0
    },
    {
      "COMPOSTO": "RET",
      "LOTE": "1087412",
      "PESO": 26.2,
      "PESO REAL": 26.1
    }
  ];

  const worksheet = XLSX.utils.json_to_sheet(sampleData);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Base Katame");
  
  XLSX.writeFile(workbook, "modelo_inventario_katame.xlsx");
}
