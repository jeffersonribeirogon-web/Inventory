import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  ArrowLeft, Trash2, Download, Mail, ScanLine, Camera, CameraOff, 
  Loader2, Upload, Save, BarChart2, AlertTriangle, FileSpreadsheet, 
  CheckCircle2, X, Check, Smartphone, QrCode, Cloud, Copy, ExternalLink, RefreshCw 
} from 'lucide-react';
import { collection, addDoc, query, orderBy, onSnapshot, deleteDoc, doc, serverTimestamp, getDocs, setDoc, getDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { Html5Qrcode } from 'html5-qrcode';
import QRCode from 'qrcode';
import { saveInventoryReport } from '../lib/reports';
import { downloadSampleExcelTemplate } from '../lib/excelBase';

export interface ExcelCaixaItem {
  composto: string;
  lote: string; // 7 digits
  peso: string | number;
  pesoReal: string | number;
}

export interface ExcelBaseMeta {
  fileName: string;
  uploadedAt: string;
  uploadedBy?: string;
  itemsCount: number;
}

interface ScanItem {
  id: string;
  composto?: string;
  lote?: string;
  unidade?: string;
  dataExpiracao?: string;
  scannedAt?: any;
  lote7?: string;
  pesoTeorico?: string | number;
  pesoReal?: string | number;
  statusConferencia?: 'ENCONTRADO' | 'FORA_DA_LISTA';
}

interface DuplicateInfo {
  id?: string;
  lote: string;
  composto?: string;
  unidade?: string;
  scannedAt?: any;
}

export function ScannerCaixas() {
  const navigate = useNavigate();
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const captureRequestedRef = useRef(false);
  const isModalOpenRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Scans state + Ref for closure-safe live duplicate checking
  const [scans, setScans] = useState<ScanItem[]>([]);
  const scansRef = useRef<ScanItem[]>([]);
  const lastScanTimeRef = useRef<{ code: string; time: number }>({ code: '', time: 0 });

  const [isReading, setIsReading] = useState(false);
  const [cameraError, setCameraError] = useState(false);
  const [isCameraActive, setIsCameraActive] = useState(true);
  const isStartingRef = useRef(false);
  
  // Modal states
  const [activeModal, setActiveModal] = useState<'none' | 'katame' | 'local' | 'manual'>('none');
  const [currentBarcode, setCurrentBarcode] = useState('');
  const [katameInput, setKatameInput] = useState('REBK');
  const [localInput, setLocalInput] = useState('UNIT1');
  const [manualBarcode, setManualBarcode] = useState('');

  const [duplicateError, setDuplicateError] = useState(false);
  const [duplicateModal, setDuplicateModal] = useState<DuplicateInfo | null>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);

  // Base Excel cross-referencing states
  const [excelBase, setExcelBase] = useState<ExcelCaixaItem[]>(() => {
    try {
      const saved = localStorage.getItem('katame_excel_base_caixas');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [excelBaseMeta, setExcelBaseMeta] = useState<ExcelBaseMeta | null>(() => {
    try {
      const saved = localStorage.getItem('katame_excel_base_caixas_meta');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });
  const [isSyncingToCloud, setIsSyncingToCloud] = useState(false);
  const [cloudNotification, setCloudNotification] = useState<string | null>(null);
  const [showQrModal, setShowQrModal] = useState(false);
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string>('');
  const [copiedLink, setCopiedLink] = useState(false);

  const [excelFoundModal, setExcelFoundModal] = useState<{
    barcode: string;
    lote7: string;
    composto: string;
    peso: string | number;
    pesoReal: string | number;
  } | null>(null);
  const [showPendingModal, setShowPendingModal] = useState(false);
  const [isOutOfExcelBase, setIsOutOfExcelBase] = useState(false);
  const excelFileInputRef = useRef<HTMLInputElement>(null);

  // QR Code generator effect
  useEffect(() => {
    if (showQrModal) {
      const targetUrl = window.location.href;
      QRCode.toDataURL(targetUrl, {
        width: 280,
        margin: 2,
        color: {
          dark: '#0f172a',
          light: '#ffffff'
        }
      })
        .then((url) => setQrCodeDataUrl(url))
        .catch((err) => console.error("Erro ao gerar QR Code:", err));
    }
  }, [showQrModal]);

  // Sincronização em tempo real da Base Excel (PC ⇄ Celular via Firestore)
  useEffect(() => {
    const baseDocRef = doc(db, 'excel_inventory_base', 'current_active_base');
    const unsubscribe = onSnapshot(baseDocRef, (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        const cloudItems = (data.items || []) as ExcelCaixaItem[];
        if (cloudItems && cloudItems.length > 0) {
          setExcelBase(cloudItems);
          const meta: ExcelBaseMeta = {
            fileName: data.fileName || 'base_katame.xlsx',
            uploadedAt: data.uploadedAt || new Date().toISOString(),
            uploadedBy: data.uploadedBy || 'PC / Nuvem',
            itemsCount: cloudItems.length
          };
          setExcelBaseMeta(meta);
          try {
            localStorage.setItem('katame_excel_base_caixas', JSON.stringify(cloudItems));
            localStorage.setItem('katame_excel_base_caixas_meta', JSON.stringify(meta));
          } catch (e) {
            console.warn("Storage warning:", e);
          }
        }
      }
    }, (err) => {
      console.log("Firestore excelBase snapshot listener notice:", err);
    });

    return () => unsubscribe();
  }, []);

  // Keep scansRef in sync with scans state
  useEffect(() => {
    scansRef.current = scans;
  }, [scans]);

  const playBeep = () => {
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const oscillator = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();
      
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(800, audioCtx.currentTime); // 800Hz beep
      
      gainNode.gain.setValueAtTime(0, audioCtx.currentTime);
      gainNode.gain.linearRampToValueAtTime(1, audioCtx.currentTime + 0.01);
      gainNode.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.15); // Short 150ms beep
      
      oscillator.connect(gainNode);
      gainNode.connect(audioCtx.destination);
      
      oscillator.start();
      oscillator.stop(audioCtx.currentTime + 0.2);
    } catch (e) {
      console.log("Audio play blocked or not supported", e);
    }
  };

  // Urgent dual-pulse low buzzer for duplicate alert
  const playDuplicateBuzzer = () => {
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const now = audioCtx.currentTime;

      // Pulse 1
      const osc1 = audioCtx.createOscillator();
      const gain1 = audioCtx.createGain();
      osc1.type = 'sawtooth';
      osc1.frequency.setValueAtTime(220, now);
      osc1.frequency.exponentialRampToValueAtTime(130, now + 0.22);
      gain1.gain.setValueAtTime(0.7, now);
      gain1.gain.linearRampToValueAtTime(0.01, now + 0.22);
      osc1.connect(gain1);
      gain1.connect(audioCtx.destination);
      osc1.start(now);
      osc1.stop(now + 0.22);

      // Pulse 2
      const osc2 = audioCtx.createOscillator();
      const gain2 = audioCtx.createGain();
      osc2.type = 'sawtooth';
      osc2.frequency.setValueAtTime(220, now + 0.28);
      osc2.frequency.exponentialRampToValueAtTime(110, now + 0.55);
      gain2.gain.setValueAtTime(0.7, now + 0.28);
      gain2.gain.linearRampToValueAtTime(0.01, now + 0.55);
      osc2.connect(gain2);
      gain2.connect(audioCtx.destination);
      osc2.start(now + 0.28);
      osc2.stop(now + 0.55);

      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        navigator.vibrate([300, 100, 350]);
      }
    } catch (e) {
      console.log("Buzzer play blocked", e);
    }
  };

  // Duplicate lookup helper for Caixas (checks both LOTE and COMPOSTO)
  const checkCaixaDuplicate = (loteTarget: string, compostoTarget: string) => {
    const cleanLote = loteTarget.trim();
    const cleanComposto = String(compostoTarget || '').trim().toUpperCase();
    return scansRef.current.find(s => 
      String(s.lote || '').trim() === cleanLote &&
      String(s.composto || '').trim().toUpperCase() === cleanComposto
    );
  };

  // Extrai os últimos 7 dígitos do código de barras de 12 dígitos para cruzar com o Excel
  const extract7Digits = (barcode: string) => {
    const clean = String(barcode || '').trim().replace(/\.0+$/, '');
    return clean.length >= 7 ? clean.slice(-7) : clean.padStart(7, '0');
  };

  // Processamento unificado de código lido (câmera, manual ou galeria)
  const processScannedBarcode = (cleanBarcode: string) => {
    setCurrentBarcode(cleanBarcode);

    // Se houver uma base Excel carregada, faz o cruzamento pelos últimos 7 dígitos!
    if (excelBase.length > 0) {
      const lote7 = extract7Digits(cleanBarcode);
      const matched = excelBase.find(item => item.lote === lote7);

      if (matched) {
        // CENÁRIO A: ENCONTRADO NO EXCEL!
        // Checa duplicidade do lote com o composto retornado da planilha
        const isDup = checkCaixaDuplicate(cleanBarcode, matched.composto);
        if (isDup) {
          playDuplicateBuzzer();
          setDuplicateModal({
            id: isDup.id,
            lote: isDup.lote || cleanBarcode,
            composto: isDup.composto,
            unidade: isDup.unidade,
            scannedAt: isDup.scannedAt
          });
          return;
        }

        playBeep();
        setIsReading(false);
        setIsOutOfExcelBase(false);
        setKatameInput(matched.composto);
        setExcelFoundModal({
          barcode: cleanBarcode,
          lote7: matched.lote,
          composto: matched.composto,
          peso: matched.peso,
          pesoReal: matched.pesoReal
        });
        return;
      } else {
        // CENÁRIO B: NÃO CONSTA NO EXCEL!
        // "Quando eu ler um lote que não consta na base do excel deve abrir todo o fluxo de registro igual ja temos"
        playBeep();
        setIsReading(false);
        setIsOutOfExcelBase(true);
        setActiveModal('katame');
        return;
      }
    }

    // Fluxo padrão caso nenhuma base Excel esteja carregada
    playBeep();
    setIsReading(false);
    setIsOutOfExcelBase(false);
    setActiveModal('katame');
  };

  // Parser inteligente de arquivos Excel (.xlsx / .csv)
  const handleExcelBaseUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = new Uint8Array(evt.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        
        // Linhas brutas como matriz 2D
        const rawRows: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });

        // Localiza a linha de cabeçalho que contenha COMPOSTO e LOTE
        let headerRowIndex = -1;
        let colComposto = -1;
        let colLote = -1;
        let colPeso = -1;
        let colPesoReal = -1;

        for (let r = 0; r < Math.min(rawRows.length, 12); r++) {
          const row = rawRows[r];
          if (!row || !Array.isArray(row)) continue;

          let foundLote = -1;
          let foundComp = -1;

          row.forEach((cell, idx) => {
            const str = String(cell || '').trim().toUpperCase();
            if (
              str.includes('LOTE') || str === 'CODIGO' || str === 'LOT' || 
              str.includes('BARCODE') || str.includes('ETIQUETA')
            ) {
              foundLote = idx;
            }
            if (
              str.includes('COMPOSTO') || str.includes('KATAME') || str.includes('PROD') || 
              str.includes('COMP') || str.includes('MATERIAL')
            ) {
              foundComp = idx;
            }
          });

          if (foundLote !== -1 && foundComp !== -1) {
            headerRowIndex = r;
            colLote = foundLote;
            colComposto = foundComp;

            // Identifica colunas de PESO e PESO REAL
            row.forEach((cell, idx) => {
              const str = String(cell || '').trim().toUpperCase();
              if (str.includes('REAL')) {
                colPesoReal = idx;
              } else if (str.includes('PESO') || str.includes('TEORICO') || str.includes('KG')) {
                colPeso = idx;
              }
            });
            break;
          }
        }

        // Se não localizou cabeçalho com texto explícito, tenta detecção por ordem padrão:
        // Coluna 0: Composto | Coluna 1: Lote | Coluna 2: Peso | Coluna 3: Peso Real
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
          if (!cleanLote || cleanLote.toUpperCase().includes('LOTE')) continue;

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
          alert("Nenhuma linha com lote válido foi encontrada na planilha. Verifique as colunas 'COMPOSTO' e 'LOTE'.");
          return;
        }

        setExcelBase(items);
        const isDesktop = typeof window !== 'undefined' && window.innerWidth > 768;
        const meta: ExcelBaseMeta = {
          fileName: file.name,
          uploadedAt: new Date().toISOString(),
          uploadedBy: isDesktop ? 'PC (Desktop)' : 'Celular (Mobile)',
          itemsCount: items.length
        };
        setExcelBaseMeta(meta);

        try {
          localStorage.setItem('katame_excel_base_caixas', JSON.stringify(items));
          localStorage.setItem('katame_excel_base_caixas_meta', JSON.stringify(meta));
        } catch (storageErr) {
          console.warn("Storage quota warning:", storageErr);
        }

        // Sincroniza imediatamente com a nuvem Firestore para o celular receber ao vivo!
        setIsSyncingToCloud(true);
        setDoc(doc(db, 'excel_inventory_base', 'current_active_base'), {
          fileName: file.name,
          uploadedAt: new Date().toISOString(),
          uploadedBy: isDesktop ? 'PC (Desktop)' : 'Celular (Mobile)',
          itemsCount: items.length,
          items: items,
          updatedAt: serverTimestamp()
        }).then(() => {
          setIsSyncingToCloud(false);
          setCloudNotification(`✅ Base sincronizada na Nuvem! Pronta para uso no celular (${items.length} caixas).`);
          setTimeout(() => setCloudNotification(null), 6000);
        }).catch((err) => {
          console.error("Erro ao sincronizar base com Firestore:", err);
          setIsSyncingToCloud(false);
        });

        alert(`✅ Base Excel importada com sucesso!\nTotal de caixas: ${items.length}\nSincronizando com a nuvem para o celular...`);
      } catch (err) {
        console.error("Erro ao importar Excel:", err);
        alert("Erro ao ler o arquivo Excel. Verifique se o formato é válido (.xlsx, .xls ou .csv).");
      } finally {
        if (excelFileInputRef.current) excelFileInputRef.current.value = '';
      }
    };
    reader.readAsArrayBuffer(file);
  };

  // Sync modal state to ref for the scanner callback
  useEffect(() => {
    isModalOpenRef.current = activeModal !== 'none' || duplicateModal !== null || excelFoundModal !== null || showPendingModal || showQrModal;
    if (activeModal === 'none') {
      setDuplicateError(false);
    }
  }, [activeModal, duplicateModal, excelFoundModal, showPendingModal, showQrModal]);

  const katames = ["REBK", "RETBK978", "RET", "RESW", "REL", "REP", "RETBSW", "RETB2", "RETB3", "RETB4", "RETBA", "RETK", "REK367"];
  const locais = ["UNIT1", "UNIT2", "UNIT3", "UNIT4", "UNIT5", "UNIT6", "TBR1", "TBR2", "MIX"];

  const [isOffline, setIsOffline] = useState(!navigator.onLine);

  useEffect(() => {
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Setup Firestore Real-time listener
  useEffect(() => {
    const q = query(collection(db, 'inventory_scans'), orderBy('scannedAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const items: ScanItem[] = [];
      snapshot.forEach((doc) => {
        items.push({ id: doc.id, ...doc.data({ serverTimestamps: 'estimate' }) } as ScanItem);
      });
      setScans(items);
    });
    return () => unsubscribe();
  }, []);

  const startScanner = async () => {
    if (!scannerRef.current || isStartingRef.current) return;
    try {
      const state = scannerRef.current.getState();
      if (state === 2) {
        setIsCameraActive(true);
        setCameraError(false);
        return;
      }
      isStartingRef.current = true;
      setCameraError(false);

      const scanConfig = {
        fps: 15,
        qrbox: { width: 320, height: 160 }
      };

      const onScanSuccess = (decodedText: string) => {
        if (isModalOpenRef.current) return; // Ignore scans while popup is open

        const cleanText = decodedText.trim();
        
        // Only accept exactly 12 numeric digits
        if (!/^\d{12}$/.test(cleanText)) return;

        // Auto-capture if barcode starts with '5'
        const isAutoMatch = cleanText.startsWith('5');

        if (isAutoMatch) {
          // Anti-spam debounce
          const now = Date.now();
          if (lastScanTimeRef.current.code === cleanText && now - lastScanTimeRef.current.time < 1500) {
            return;
          }
          lastScanTimeRef.current = { code: cleanText, time: now };

          processScannedBarcode(cleanText);
        }
      };

      try {
        await scannerRef.current.start(
          { facingMode: "environment" },
          scanConfig,
          onScanSuccess,
          () => {}
        );
      } catch (firstErr: any) {
        const errStr = String(firstErr?.name || firstErr?.message || firstErr || '');
        // If it's a device constraint error (e.g. desktop/laptop has no environment camera), try front/default camera
        if (
          !errStr.includes('NotAllowedError') &&
          !errStr.includes('Permission denied') &&
          !errStr.includes('NotAllowed')
        ) {
          await scannerRef.current.start(
            { facingMode: "user" },
            scanConfig,
            onScanSuccess,
            () => {}
          );
        } else {
          throw firstErr;
        }
      }

      setIsCameraActive(true);
      setCameraError(false);
    } catch (err: any) {
      console.warn("Camera permission or hardware access notice:", err?.name || err?.message || err);
      setCameraError(true);
      setIsCameraActive(false);
    } finally {
      isStartingRef.current = false;
    }
  };

  const stopScanner = async () => {
    if (!scannerRef.current) return;
    try {
      const state = scannerRef.current.getState();
      if (state === 2) {
        await scannerRef.current.stop();
      }
      setIsCameraActive(false);
    } catch (err) {
      console.error("Error stopping camera:", err);
    }
  };

  const toggleCamera = () => {
    if (isCameraActive) {
      stopScanner();
    } else {
      startScanner();
    }
  };

  // Initialize Barcode Scanner
  useEffect(() => {
    const scanner = new Html5Qrcode("reader");
    scannerRef.current = scanner;

    startScanner();

    return () => {
      try {
        if (scanner.getState() === 2) {
          scanner.stop().then(() => scanner.clear()).catch(console.error);
        }
      } catch (e) {
        console.error("Error during cleanup:", e);
      }
    };
  }, []);

  const openManualModal = () => {
    setManualBarcode('');
    setActiveModal('manual');
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    let finalBarcode = manualBarcode.trim();
    
    // Check if it has any non-numeric characters
    if (!/^\d+$/.test(finalBarcode)) {
      alert("O lote deve conter apenas números. Verifique se há letras ou caracteres especiais digitados.");
      return;
    }

    if (finalBarcode.length === 11 && !finalBarcode.startsWith('5')) {
      finalBarcode = '5' + finalBarcode;
    } else if (finalBarcode.length !== 12) {
      alert("O lote digitado é inválido. Digite os 11 números após o 5, ou os 12 números do código completo.");
      return;
    } else if (!finalBarcode.startsWith('5')) {
      alert("O lote completo de 12 dígitos deve começar com o número 5.");
      return;
    }
    
    processScannedBarcode(finalBarcode);
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !scannerRef.current) return;
    
    try {
      setIsReading(true);
      const decodedText = await scannerRef.current.scanFile(file, true);
      const cleanText = decodedText.trim();
      
      if (!/^\d{12}$/.test(cleanText)) {
        alert("O código de barras da imagem é inválido. Deve conter exatamente 12 números.");
        return;
      }
      
      if (!cleanText.startsWith('5')) {
        alert("O código de barras da imagem não começa com o número 5.");
        return;
      }
      
      processScannedBarcode(cleanText);
    } catch (err) {
      console.error(err);
      alert("Nenhum código de barras encontrado na imagem.");
    } finally {
      setIsReading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Step 1: Katame confirm -> verifies duplicate (Lote + Katame) before advancing to Step 2: Local
  const handleKatameConfirm = () => {
    const cleanKatame = katameInput.trim().toUpperCase();
    
    // Checagem de Duplicidade: Executada APÓS a seleção do composto
    // (Permite lotes iguais com compostos diferentes, mas bloqueia se Lote + Composto forem iguais)
    const existing = checkCaixaDuplicate(currentBarcode, cleanKatame);
    if (existing) {
      playDuplicateBuzzer();
      setDuplicateModal({
        id: existing.id,
        lote: existing.lote || currentBarcode,
        composto: existing.composto,
        unidade: existing.unidade,
        scannedAt: existing.scannedAt
      });
      return;
    }

    setActiveModal('local');
  };

  const saveScan = async (e: React.FormEvent) => {
    e.preventDefault();
    setDuplicateError(false);
    
    // Robust Duplicate check pre-save (Lote + Katame)
    const existing = checkCaixaDuplicate(currentBarcode, katameInput);
    if (existing) {
      playDuplicateBuzzer();
      closeModalAndResume();
      setDuplicateModal({
        id: existing.id,
        lote: existing.lote || currentBarcode,
        composto: existing.composto,
        unidade: existing.unidade,
        scannedAt: existing.scannedAt
      });
      return;
    }

    const lote7 = extract7Digits(currentBarcode);
    const statusConf = excelBase.length > 0 ? 'FORA_DA_LISTA' : undefined;

    try {
      await addDoc(collection(db, 'inventory_scans'), {
        lote: currentBarcode,
        lote7: lote7,
        composto: katameInput,
        unidade: localInput,
        statusConferencia: statusConf,
        scannedAt: serverTimestamp()
      });
      
      closeModalAndResume();
    } catch (err) {
      console.error(err);
      const newScan: ScanItem = {
        id: crypto.randomUUID(),
        lote: currentBarcode,
        lote7: lote7,
        composto: katameInput,
        unidade: localInput,
        statusConferencia: statusConf,
        scannedAt: new Date()
      };
      setScans(prev => [newScan, ...prev]);
      closeModalAndResume();
    }
  };

  // Salva a leitura de uma caixa confirmada pelo cruzamento do Excel
  const confirmSaveExcelFound = async () => {
    if (!excelFoundModal) return;

    try {
      await addDoc(collection(db, 'inventory_scans'), {
        lote: excelFoundModal.barcode,
        lote7: excelFoundModal.lote7,
        composto: excelFoundModal.composto,
        unidade: localInput || 'UNIT1',
        pesoTeorico: excelFoundModal.peso,
        pesoReal: excelFoundModal.pesoReal,
        statusConferencia: 'ENCONTRADO',
        scannedAt: serverTimestamp()
      });
    } catch (err) {
      console.error(err);
      const newScan: ScanItem = {
        id: crypto.randomUUID(),
        lote: excelFoundModal.barcode,
        lote7: excelFoundModal.lote7,
        composto: excelFoundModal.composto,
        unidade: localInput || 'UNIT1',
        pesoTeorico: excelFoundModal.peso,
        pesoReal: excelFoundModal.pesoReal,
        statusConferencia: 'ENCONTRADO',
        scannedAt: new Date()
      };
      setScans(prev => [newScan, ...prev]);
    }

    setExcelFoundModal(null);
    setCurrentBarcode('');
  };

  const cancelScan = () => {
    closeModalAndResume();
  };

  const closeModalAndResume = () => {
    setActiveModal('none');
    // Keep Katame in memory (do not reset katameInput)
    // Always reset local to UNIT1:
    setLocalInput('UNIT1');
    setCurrentBarcode('');
    setIsOutOfExcelBase(false);
  };

  // Confirmation Modals
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<string | null>(null);

  const deleteItem = (id: string) => {
    setItemToDelete(id);
  };

  const confirmDelete = async () => {
    if (itemToDelete) {
      await deleteDoc(doc(db, 'inventory_scans', itemToDelete));
      setItemToDelete(null);
    }
  };

  const clearAll = () => {
    setShowClearConfirm(true);
  };

  const confirmClearAll = async () => {
    setShowClearConfirm(false);
    const q = query(collection(db, 'inventory_scans'));
    const querySnapshot = await getDocs(q);
    const deletePromises = querySnapshot.docs.map((docSnapshot) => 
      deleteDoc(doc(db, 'inventory_scans', docSnapshot.id))
    );
    await Promise.all(deletePromises);
  };

  const foundLotesSet = new Set(
    scans.map(s => s.lote7 || (s.lote ? extract7Digits(s.lote) : ''))
  );
  const pendingExcelItems = excelBase.filter(item => !foundLotesSet.has(item.lote));
  const foundExcelCount = excelBase.length - pendingExcelItems.length;

  const exportCSV = () => {
    const csvData = scans.map(s => ({
      'Lote (Barcode 12 dig)': s.lote || '',
      'Lote (7 dig)': s.lote7 || (s.lote ? extract7Digits(s.lote) : ''),
      'Composto': s.composto || '',
      'Unidade (Local)': s.unidade || '',
      'Status Base Excel': s.statusConferencia === 'ENCONTRADO' 
        ? 'CONFERIDO NO EXCEL' 
        : (s.statusConferencia === 'FORA_DA_LISTA' ? 'FORA DA BASE (SOBRA)' : 'LIDO'),
      'Peso Teórico (kg)': s.pesoTeorico || '',
      'Peso Real (kg)': s.pesoReal || '',
      'Data/Hora (App)': s.scannedAt?.toDate() ? s.scannedAt.toDate().toLocaleString('pt-BR') : 'N/A'
    }));
    const csv = Papa.unparse(csvData);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `inventario_caixas_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const sendEmail = () => {
    const csvData = scans.map(s => ({
      'Lote (Barcode 12 dig)': s.lote || '',
      'Lote (7 dig)': s.lote7 || (s.lote ? extract7Digits(s.lote) : ''),
      'Composto': s.composto || '',
      'Unidade (Local)': s.unidade || '',
      'Status Base Excel': s.statusConferencia === 'ENCONTRADO' 
        ? 'CONFERIDO NO EXCEL' 
        : (s.statusConferencia === 'FORA_DA_LISTA' ? 'FORA DA BASE (SOBRA)' : 'LIDO'),
      'Peso Teórico (kg)': s.pesoTeorico || '',
      'Peso Real (kg)': s.pesoReal || '',
      'Data/Hora (App)': s.scannedAt?.toDate() ? s.scannedAt.toDate().toLocaleString('pt-BR') : 'N/A'
    }));
    const csv = Papa.unparse(csvData);
    const subject = encodeURIComponent("Inventário de Caixas de Katame");
    const body = encodeURIComponent("Segue os dados do inventário de caixas coletados pelo app:\n\n" + csv);
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
  };

  return (
    <div className="min-h-screen bg-[#eeeeee] flex flex-col max-w-lg mx-auto shadow-xl relative">
      
      {/* MODAL DE BLOQUEIO DE DUPLICIDADE (CAIXAS) */}
      {duplicateModal && (
        <div className="fixed inset-0 z-[100] bg-black/85 flex items-center justify-center p-4 backdrop-blur-md animate-in fade-in duration-200">
          <Card className="w-full max-w-sm p-6 bg-white border-2 border-red-500 shadow-2xl rounded-2xl animate-in zoom-in-95 duration-200">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0 text-red-600">
                <AlertTriangle className="h-6 w-6 stroke-[2.5]" />
              </div>
              <div>
                <span className="text-[11px] font-extrabold uppercase tracking-wider text-red-600 bg-red-50 px-2 py-0.5 rounded">
                  Bloqueio de Duplicidade
                </span>
                <h3 className="text-lg font-bold text-neutral-900 leading-tight mt-0.5">
                  Lote Já Registrado!
                </h3>
              </div>
            </div>

            <p className="text-xs text-neutral-600 mb-4 leading-relaxed">
              O lote <strong>{duplicateModal.lote}</strong> já foi registrado anteriormente com o composto <strong>{duplicateModal.composto}</strong>. Para evitar contagem dupla, este registro foi bloqueado.
            </p>

            {/* Previous scan details */}
            <div className="bg-neutral-50 border border-neutral-200 rounded-xl p-3.5 mb-5 space-y-2">
              <div className="flex justify-between items-center border-b border-neutral-200/80 pb-2">
                <span className="text-xs text-neutral-500 font-medium">Lote:</span>
                <span className="font-mono font-bold text-base text-neutral-900">{duplicateModal.lote}</span>
              </div>
              <div className="flex justify-between items-center text-xs">
                <span className="text-neutral-500 font-medium">Katame (Composto):</span>
                <span className="font-bold text-[#2941CC] bg-[#2941CC]/10 px-2 py-0.5 rounded">
                  {duplicateModal.composto || 'NÃO INFORMADO'}
                </span>
              </div>
              {duplicateModal.unidade && (
                <div className="flex justify-between items-center text-xs">
                  <span className="text-neutral-500 font-medium">Localização:</span>
                  <span className="font-bold text-neutral-800 bg-neutral-200 px-2 py-0.5 rounded">
                    {duplicateModal.unidade}
                  </span>
                </div>
              )}
              <div className="flex justify-between items-center text-[11px] pt-1 text-neutral-400">
                <span>Registrado em:</span>
                <span className="font-medium text-neutral-600">
                  {duplicateModal.scannedAt?.toDate 
                    ? duplicateModal.scannedAt.toDate().toLocaleTimeString('pt-BR') 
                    : 'Hoje'}
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <Button
                onClick={() => {
                  setDuplicateModal(null);
                  closeModalAndResume();
                }}
                className="w-full bg-red-600 hover:bg-red-700 text-white font-bold py-3 rounded-xl shadow-lg"
              >
                Descartar Leitura
              </Button>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setDuplicateModal(null);
                    setActiveModal('katame');
                  }}
                  className="flex-1 border-neutral-300 text-neutral-700 text-xs py-2"
                >
                  Trocar Composto
                </Button>
                {duplicateModal.id && (
                  <Button
                    variant="outline"
                    onClick={() => {
                      const id = duplicateModal.id;
                      setDuplicateModal(null);
                      closeModalAndResume();
                      setHighlightedId(id);
                      setTimeout(() => {
                        const el = document.getElementById(`item-${id}`);
                        el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                      }, 150);
                      setTimeout(() => setHighlightedId(null), 4000);
                    }}
                    className="flex-1 border-neutral-300 text-neutral-700 text-xs py-2"
                  >
                    Ver na Lista
                  </Button>
                )}
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* MODAL: CAIXA ENCONTRADA NA BASE EXCEL */}
      {excelFoundModal && (
        <div className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in duration-200">
          <Card className="w-full max-w-sm p-6 bg-white border-2 border-emerald-500 shadow-2xl rounded-2xl animate-in zoom-in-95 duration-200">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center flex-shrink-0 text-emerald-600">
                <CheckCircle2 className="h-7 w-7" />
              </div>
              <div>
                <span className="text-[11px] font-extrabold uppercase tracking-wider text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                  Cruzamento Excel OK
                </span>
                <h3 className="text-lg font-bold text-neutral-900 leading-tight mt-0.5">
                  Caixa Encontrada!
                </h3>
              </div>
            </div>

            <p className="text-xs text-neutral-600 mb-4 leading-relaxed">
              O lote conferiu com a lista da área. Dados retornados da planilha:
            </p>

            <div className="bg-neutral-50 border border-neutral-200 rounded-xl p-3.5 mb-5 space-y-2.5">
              <div className="flex justify-between items-center border-b border-neutral-200/80 pb-2">
                <span className="text-xs text-neutral-500 font-medium">Barcode Lido:</span>
                <span className="font-mono font-bold text-sm text-neutral-800">
                  {excelFoundModal.barcode.length >= 7 
                    ? excelFoundModal.barcode.slice(0, -7)
                    : ''}
                  <span className="text-emerald-600 bg-emerald-50 px-1 rounded underline font-extrabold">
                    {excelFoundModal.lote7}
                  </span>
                </span>
              </div>
              
              <div className="flex justify-between items-center text-xs">
                <span className="text-neutral-500 font-medium">Composto (Katame):</span>
                <span className="font-bold text-base text-[#2941CC] bg-[#2941CC]/10 px-2.5 py-0.5 rounded">
                  {excelFoundModal.composto}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 pt-1 border-t border-neutral-200/60">
                <div className="bg-white p-2 rounded-lg border border-neutral-200">
                  <span className="block text-[10px] text-neutral-400 uppercase font-semibold">Peso Teórico</span>
                  <span className="font-bold text-sm text-neutral-800">
                    {excelFoundModal.peso ? `${excelFoundModal.peso} kg` : '-'}
                  </span>
                </div>
                <div className="bg-white p-2 rounded-lg border border-emerald-200 bg-emerald-50/40">
                  <span className="block text-[10px] text-emerald-700 uppercase font-semibold">Peso Real</span>
                  <span className="font-bold text-sm text-emerald-900">
                    {excelFoundModal.pesoReal ? `${excelFoundModal.pesoReal} kg` : '-'}
                  </span>
                </div>
              </div>

              <div className="pt-2 border-t border-neutral-200/80">
                <label className="block text-[11px] font-semibold text-neutral-600 mb-1">
                  Localização:
                </label>
                <select
                  value={localInput}
                  onChange={(e) => setLocalInput(e.target.value)}
                  className="w-full border border-neutral-300 rounded-lg p-2 text-sm bg-white font-medium focus:ring-[#009988] focus:border-[#009988]"
                >
                  {locais.map((l) => (
                    <option key={l} value={l}>{l}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setExcelFoundModal(null);
                  setCurrentBarcode('');
                }}
                className="flex-1 border-neutral-300 text-neutral-600 text-xs py-2.5"
              >
                Descartar
              </Button>
              <Button
                onClick={confirmSaveExcelFound}
                className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm py-2.5 shadow-lg flex items-center justify-center gap-1.5"
              >
                <Check className="h-4 w-4" />
                Confirmar
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* MODAL: ITENS PENDENTES DA BASE EXCEL */}
      {showPendingModal && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in duration-200">
          <Card className="w-full max-w-md max-h-[85vh] flex flex-col p-5 bg-white shadow-2xl rounded-2xl animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between pb-3 border-b border-neutral-200 mb-3">
              <div>
                <h3 className="text-base font-bold text-neutral-900 flex items-center gap-2">
                  <FileSpreadsheet className="h-5 w-5 text-emerald-600" />
                  Caixas Pendentes ({pendingExcelItems.length})
                </h3>
                <p className="text-xs text-neutral-500">
                  Caixas da base Excel que ainda não foram bipadas
                </p>
              </div>
              <Button variant="ghost" size="icon" onClick={() => setShowPendingModal(false)} className="h-8 w-8">
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-2 pr-1">
              {pendingExcelItems.length === 0 ? (
                <div className="text-center py-10 text-neutral-500 text-sm">
                  <CheckCircle2 className="h-10 w-10 text-emerald-500 mx-auto mb-2" />
                  <p className="font-bold text-emerald-800">Todas as caixas foram encontradas!</p>
                  <p className="text-xs text-neutral-400 mt-1">100% da lista Excel conferida na área.</p>
                </div>
              ) : (
                pendingExcelItems.map((item, idx) => (
                  <div key={idx} className="p-3 bg-neutral-50 border border-neutral-200 rounded-xl flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <span className="font-bold text-xs bg-[#2941CC]/10 text-[#2941CC] px-2 py-0.5 rounded">
                          {item.composto}
                        </span>
                        <span className="font-mono font-bold text-sm text-neutral-900">
                          {item.lote}
                        </span>
                      </div>
                      <div className="text-[11px] text-neutral-500 flex gap-2">
                        {item.peso && <span>Teór: <strong>{item.peso} kg</strong></span>}
                        {item.pesoReal && <span>Real: <strong>{item.pesoReal} kg</strong></span>}
                      </div>
                    </div>
                    <span className="text-[10px] font-bold text-amber-600 bg-amber-50 border border-amber-200 px-2 py-1 rounded-full">
                      Pendente
                    </span>
                  </div>
                ))
              )}
            </div>

            <div className="pt-3 border-t border-neutral-200 mt-3 flex justify-end">
              <Button onClick={() => setShowPendingModal(false)} className="w-full bg-neutral-900 hover:bg-neutral-800 text-white text-xs font-semibold py-2.5 rounded-xl">
                Fechar
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* MODAL: ABRIR NO CELULAR (QR CODE & SINCRONIZAÇÃO EM NUVEM) */}
      {showQrModal && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in duration-200">
          <Card className="w-full max-w-md bg-white shadow-2xl rounded-2xl p-6 animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between pb-3 border-b border-neutral-200 mb-4">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-center text-[#2941CC]">
                  <Smartphone className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-neutral-900 leading-tight">
                    Usar no Celular com Câmera
                  </h3>
                  <p className="text-xs text-neutral-500">
                    Sincronização em tempo real PC ⇄ Celular
                  </p>
                </div>
              </div>
              <Button variant="ghost" size="icon" onClick={() => setShowQrModal(false)} className="h-8 w-8 text-neutral-500 hover:text-neutral-800">
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="space-y-4">
              {/* QR Code Container */}
              <div className="flex flex-col items-center justify-center p-4 bg-neutral-50 border border-neutral-200 rounded-2xl">
                {qrCodeDataUrl ? (
                  <img 
                    src={qrCodeDataUrl} 
                    alt="QR Code para Celular" 
                    className="w-56 h-56 rounded-xl shadow-inner bg-white p-2 border border-neutral-200"
                  />
                ) : (
                  <div className="w-56 h-56 flex items-center justify-center bg-white rounded-xl">
                    <Loader2 className="h-8 w-8 animate-spin text-neutral-400" />
                  </div>
                )}
                <span className="text-xs font-semibold text-neutral-600 mt-2 flex items-center gap-1.5">
                  <QrCode className="h-3.5 w-3.5 text-blue-600" />
                  Aponte a câmera do seu celular para este código
                </span>
              </div>

              {/* Como funciona */}
              <div className="bg-blue-50/70 border border-blue-200/80 rounded-xl p-3 text-xs text-blue-900 space-y-1.5">
                <p className="font-bold flex items-center gap-1 text-blue-800">
                  <Cloud className="h-3.5 w-3.5 text-blue-600" />
                  Como funciona a conexão PC ⇄ Celular:
                </p>
                <ol className="list-decimal list-inside space-y-1 text-blue-700">
                  <li><strong>Suba a planilha no PC:</strong> Ela é salva na nuvem segura em tempo real.</li>
                  <li><strong>Abra no Celular:</strong> Pelo QR Code acima, o aplicativo abre no seu celular com a base já carregada!</li>
                  <li><strong>Bipe as caixas na área:</strong> O celular cruza os 7 dígitos na hora e atualiza o PC ao vivo.</li>
                </ol>
              </div>

              {/* Copy Link */}
              <div className="flex items-center gap-2 p-2 bg-neutral-100 rounded-xl text-xs">
                <span className="truncate flex-1 font-mono text-neutral-700 px-1">
                  {typeof window !== 'undefined' ? window.location.href : ''}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    if (navigator.clipboard) {
                      navigator.clipboard.writeText(window.location.href);
                      setCopiedLink(true);
                      setTimeout(() => setCopiedLink(false), 2500);
                    }
                  }}
                  className="h-8 text-xs font-semibold border-neutral-300 bg-white"
                >
                  {copiedLink ? (
                    <span className="flex items-center gap-1 text-emerald-600 font-bold">
                      <Check className="h-3.5 w-3.5" /> Copiado!
                    </span>
                  ) : (
                    <span className="flex items-center gap-1">
                      <Copy className="h-3.5 w-3.5" /> Copiar Link
                    </span>
                  )}
                </Button>
              </div>
            </div>

            <div className="mt-5 pt-3 border-t border-neutral-200 flex justify-end">
              <Button
                onClick={() => setShowQrModal(false)}
                className="w-full bg-[#2941CC] hover:bg-[#2941CC]/90 text-white font-semibold py-2.5 rounded-xl shadow"
              >
                Entendido / Fechar
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* Modals para apagar itens */}
      {itemToDelete && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 backdrop-blur-sm">
          <Card className="w-full max-w-sm p-6 animate-in fade-in zoom-in duration-200">
            <h3 className="text-xl font-bold text-neutral-900 mb-2">Remover Item?</h3>
            <p className="text-neutral-500 mb-6">Tem certeza que deseja apagar este código?</p>
            <div className="flex gap-3 justify-end">
              <Button variant="outline" onClick={() => setItemToDelete(null)} className="flex-1">Cancelar</Button>
              <Button onClick={confirmDelete} className="flex-1 bg-red-500 hover:bg-red-600 text-white">Apagar</Button>
            </div>
          </Card>
        </div>
      )}

      {showClearConfirm && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 backdrop-blur-sm">
          <Card className="w-full max-w-sm p-6 animate-in fade-in zoom-in duration-200 shadow-2xl">
            <h3 className="text-xl font-bold text-neutral-900 mb-2">Limpar Leituras Ativas?</h3>
            <p className="text-sm text-neutral-600 mb-6">
              Você tem <strong>{scans.length} caixas</strong> registradas. Deseja arquivar o relatório deste inventário no Histórico de Relatórios antes de limpar a tela do scanner?
            </p>
            <div className="space-y-2.5">
              <Button 
                onClick={async () => {
                  try {
                    if (scans.length > 0) {
                      await saveInventoryReport(scans);
                    }
                    await confirmClearAll();
                    alert("Relatório salvo no histórico com sucesso e leituras do scanner limpas!");
                  } catch (err) {
                    console.error(err);
                    alert("Erro ao arquivar e limpar.");
                  }
                }} 
                className="w-full bg-[#009988] hover:bg-[#008877] text-white font-semibold py-2.5 flex items-center justify-center gap-2"
              >
                <Save className="h-4 w-4" />
                Salvar no Histórico & Limpar
              </Button>
              <Button 
                onClick={confirmClearAll} 
                variant="outline"
                className="w-full text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700 py-2 text-xs font-semibold"
              >
                Apenas Limpar sem Salvar
              </Button>
              <Button 
                variant="ghost" 
                onClick={() => setShowClearConfirm(false)} 
                className="w-full text-neutral-500 py-2 text-xs"
              >
                Cancelar
              </Button>
            </div>
          </Card>
        </div>
      )}

      {activeModal === 'manual' && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 backdrop-blur-sm">
          <Card className="w-full max-w-sm animate-in fade-in zoom-in duration-200">
            <form onSubmit={handleManualSubmit} className="p-6">
              <h3 className="text-xl font-bold text-neutral-900 mb-2">Entrada Manual</h3>
              <p className="text-sm text-neutral-500 mb-6">Digite os 11 números após o "5", ou o lote completo com 12 dígitos.</p>
              
              <div className="space-y-4 mb-6">
                <div>
                  <label className="block text-sm font-medium text-neutral-700 mb-1">
                    Código do Lote
                  </label>
                  <input
                    type="number"
                    value={manualBarcode}
                    onChange={(e) => setManualBarcode(e.target.value)}
                    className="w-full border-neutral-300 rounded-md shadow-sm border p-3 text-lg focus:ring-[#009988] focus:border-[#009988] bg-white font-mono"
                    placeholder="Ex: 51234567890"
                    autoFocus
                  />
                </div>
              </div>
              
              <div className="flex gap-3 justify-end">
                <Button type="button" variant="outline" onClick={() => setActiveModal('none')} className="flex-1">
                  Cancelar
                </Button>
                <Button type="submit" className="flex-1 bg-[#009988] hover:bg-[#008877] text-white">
                  Avançar
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}

      {activeModal === 'katame' && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 backdrop-blur-sm">
          <Card className="w-full max-w-sm animate-in fade-in zoom-in duration-200">
            <div className="p-6">
              {isOutOfExcelBase && excelBase.length > 0 && (
                <div className="mb-3.5 p-2.5 bg-amber-50 border border-amber-300 rounded-xl flex items-start gap-2 text-amber-900 text-xs font-semibold animate-in fade-in">
                  <AlertTriangle className="h-4 w-4 text-amber-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <span className="block font-bold text-amber-900">Lote Fora da Base Excel (Sobra)</span>
                    <span className="font-normal text-[11px] text-amber-800 leading-tight block mt-0.5">
                      O código {extract7Digits(currentBarcode)} não consta na planilha. Cadastre o Katame e Local normalmente:
                    </span>
                  </div>
                </div>
              )}
              <h3 className="text-xl font-bold text-neutral-900 mb-1">Código Lido!</h3>
              <p className="text-sm font-mono text-neutral-500 mb-6 bg-neutral-100 p-2 rounded border">{currentBarcode}</p>
              
              <div className="space-y-4 mb-6">
                <div>
                  <label className="block text-sm font-medium text-neutral-700 mb-1">
                    1. Selecione o Katame
                  </label>
                  <select
                    value={katameInput}
                    onChange={(e) => setKatameInput(e.target.value)}
                    className="w-full border-neutral-300 rounded-md shadow-sm border p-3 text-lg focus:ring-[#009988] focus:border-[#009988] bg-white"
                  >
                    {katames.map((k) => (
                      <option key={k} value={k}>{k}</option>
                    ))}
                  </select>
                </div>
              </div>
              
              <div className="flex gap-3 justify-end">
                <Button type="button" variant="outline" onClick={cancelScan} className="flex-1">
                  Cancelar
                </Button>
                <Button type="button" onClick={handleKatameConfirm} className="flex-1 bg-[#009988] hover:bg-[#008877] text-white">
                  Próximo
                </Button>
              </div>
            </div>
          </Card>
        </div>
      )}

      {activeModal === 'local' && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 backdrop-blur-sm">
          <Card className="w-full max-w-sm animate-in fade-in zoom-in duration-200">
            <form onSubmit={saveScan} className="p-6">
              <h3 className="text-xl font-bold text-neutral-900 mb-6">Última Etapa</h3>
              
              <div className="space-y-4 mb-6">
                {duplicateError && (
                  <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded text-sm font-semibold mb-4 animate-in fade-in slide-in-from-top-2">
                    ⚠️ DUPLICIDADE DETECTADA:<br/><span className="font-normal text-xs">Este Lote já foi registrado com este Katame e Local. Mude os dados ou ignore.</span>
                  </div>
                )}
                <div>
                  <label className="block text-sm font-medium text-neutral-700 mb-1">
                    2. Selecione o Local
                  </label>
                  <select
                    value={localInput}
                    onChange={(e) => setLocalInput(e.target.value)}
                    className="w-full border-neutral-300 rounded-md shadow-sm border p-3 text-lg focus:ring-[#009988] focus:border-[#009988] bg-white"
                  >
                    {locais.map((l) => (
                      <option key={l} value={l}>{l}</option>
                    ))}
                  </select>
                </div>
              </div>
              
              <div className="flex gap-3 justify-end">
                <Button type="button" variant="outline" onClick={() => setActiveModal('katame')} className="flex-1">
                  Voltar
                </Button>
                <Button type="submit" className="flex-1 bg-[#009988] hover:bg-[#008877] text-white">
                  Salvar
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}
      
      <header className="bg-white p-4 flex items-center justify-between border-b border-neutral-200 z-10 relative">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate('/')}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h2 className="font-semibold text-lg text-neutral-900">Scanner Etiquetas (Reuso)</h2>
        </div>
        <div className="flex gap-2 items-center">
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={() => navigate('/relatorio-caixas')} 
            title="Abrir Relatórios de Inventário"
            className="text-[#f59e0b] hover:text-[#d97706] hover:bg-amber-50"
          >
            <BarChart2 className="h-5 w-5" />
          </Button>
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={() => setShowQrModal(true)} 
            title="Abrir no Celular (QR Code)"
            className="text-blue-600 hover:text-blue-700 hover:bg-blue-50"
          >
            <Smartphone className="h-5 w-5" />
          </Button>
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={toggleCamera} 
            title={isCameraActive ? "Desligar câmera (Economia de energia)" : "Ligar câmera"}
            className={isCameraActive ? "text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50" : "text-amber-500 hover:text-amber-600 hover:bg-amber-50"}
          >
            {isCameraActive ? <Camera className="h-5 w-5" /> : <CameraOff className="h-5 w-5" />}
          </Button>
          <Button variant="ghost" size="icon" onClick={exportCSV} title="Exportar CSV">
            <Download className="h-5 w-5 text-[#2941CC]" />
          </Button>
          <Button variant="ghost" size="icon" onClick={sendEmail} title="Enviar por Email">
            <Mail className="h-5 w-5 text-[#2941CC]" />
          </Button>
        </div>
      </header>

      {/* CLOUD SYNC NOTIFICATION BANNER */}
      {cloudNotification && (
        <div className="bg-emerald-600 text-white px-4 py-2 text-xs font-semibold flex items-center justify-between shadow-md z-20 relative animate-in slide-in-from-top duration-200">
          <div className="flex items-center gap-2">
            <Cloud className="h-4 w-4" />
            <span>{cloudNotification}</span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setCloudNotification(null)}
            className="text-white hover:bg-emerald-700 h-6 w-6 p-0"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}

      {isOffline && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 flex items-center justify-center text-amber-800 text-xs font-medium z-10 relative shadow-sm">
          <span className="w-2 h-2 rounded-full bg-amber-500 mr-2 animate-pulse"></span>
          Modo Offline Ativo. Leituras serão sincronizadas quando houver internet.
        </div>
      )}

      {/* EXCEL BASE BANNER & RECONCILIATION BAR */}
      <div className="bg-white border-b border-neutral-200 px-4 py-2.5 z-10 relative shadow-xs">
        <input 
          type="file" 
          accept=".xlsx, .xls, .csv" 
          ref={excelFileInputRef} 
          onChange={handleExcelBaseUpload} 
          className="hidden" 
        />
        
        {excelBase.length === 0 ? (
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5">
            <div className="flex items-center gap-2.5 text-neutral-600">
              <div className="w-8 h-8 rounded-lg bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-600 flex-shrink-0">
                <FileSpreadsheet className="h-4 w-4" />
              </div>
              <div className="text-xs">
                <span className="font-bold text-neutral-800 block">Cruzar com Lista Excel</span>
                <span className="text-[11px] text-neutral-500">
                  Carregue no PC e bipe pelo celular na área (sincronização na nuvem)
                </span>
              </div>
            </div>
            <div className="flex items-center gap-1.5 w-full sm:w-auto justify-end flex-wrap">
              <Button
                size="sm"
                variant="ghost"
                onClick={downloadSampleExcelTemplate}
                title="Baixar Planilha Modelo (.xlsx)"
                className="text-xs text-neutral-600 hover:text-emerald-700 hover:bg-emerald-50 h-8 flex items-center gap-1.5 rounded-lg"
              >
                <Download className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Modelo</span> .xlsx
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setShowQrModal(true)}
                className="text-xs font-semibold border-blue-400 text-blue-700 hover:bg-blue-50 flex items-center gap-1.5 h-8 rounded-lg shadow-sm"
              >
                <Smartphone className="h-3.5 w-3.5" />
                Abrir no Celular
              </Button>
              <Button
                size="sm"
                onClick={() => excelFileInputRef.current?.click()}
                className="text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white flex items-center gap-1.5 h-8 rounded-lg shadow-sm"
              >
                <Upload className="h-3.5 w-3.5" />
                Carregar Excel
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-1.5">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                <span className="text-xs font-bold text-neutral-800 flex items-center gap-1">
                  <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-600" />
                  Base Excel ({excelBase.length} caixas)
                </span>
                <span className="inline-flex items-center gap-1 text-[10px] bg-blue-50 text-blue-700 border border-blue-200 px-1.5 py-0.5 rounded-full font-medium">
                  <Cloud className="h-3 w-3 text-blue-600" />
                  Nuvem PC ⇄ Celular
                </span>
                {isSyncingToCloud && (
                  <Loader2 className="h-3 w-3 animate-spin text-blue-600" />
                )}
              </div>
              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setShowQrModal(true)}
                  className="text-[11px] font-bold text-blue-700 border-blue-300 hover:bg-blue-50 h-7 px-2 flex items-center gap-1 rounded-lg"
                  title="Conectar celular pelo QR Code"
                >
                  <Smartphone className="h-3 w-3 text-blue-600" />
                  No Celular
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setShowPendingModal(true)}
                  className="text-[11px] font-bold text-[#2941CC] hover:bg-[#2941CC]/10 h-7 px-2"
                >
                  Pendentes ({pendingExcelItems.length})
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={downloadSampleExcelTemplate}
                  title="Baixar Planilha Modelo (.xlsx)"
                  className="text-neutral-500 hover:text-emerald-700 h-7 w-7 p-0"
                >
                  <Download className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => excelFileInputRef.current?.click()}
                  title="Trocar planilha Excel"
                  className="text-neutral-500 hover:text-neutral-800 h-7 w-7 p-0"
                >
                  <Upload className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    if (confirm("Deseja remover a planilha Excel? Isso atualizará tanto o PC quanto o Celular conectado.")) {
                      setExcelBase([]);
                      setExcelBaseMeta(null);
                      try {
                        localStorage.removeItem('katame_excel_base_caixas');
                        localStorage.removeItem('katame_excel_base_caixas_meta');
                        await deleteDoc(doc(db, 'excel_inventory_base', 'current_active_base'));
                      } catch (e) {
                        console.warn(e);
                      }
                    }
                  }}
                  title="Remover base Excel"
                  className="text-red-400 hover:text-red-600 h-7 w-7 p-0"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            {/* Meta info when available */}
            {excelBaseMeta && (
              <div className="flex items-center justify-between text-[10px] text-neutral-500 px-0.5">
                <span className="truncate max-w-[220px]">
                  Arquivo: <strong className="text-neutral-700">{excelBaseMeta.fileName}</strong> {excelBaseMeta.uploadedBy ? `(${excelBaseMeta.uploadedBy})` : ''}
                </span>
                <span>
                  Sincronizado: {new Date(excelBaseMeta.uploadedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            )}

            {/* Progress indicator */}
            <div className="flex items-center gap-2">
              <div className="flex-1 bg-neutral-100 rounded-full h-2 overflow-hidden flex">
                <div 
                  className="bg-emerald-500 h-full transition-all duration-300" 
                  style={{ width: `${excelBase.length > 0 ? (foundExcelCount / excelBase.length) * 100 : 0}%` }}
                />
              </div>
              <span className="text-[11px] font-bold text-neutral-700 font-mono">
                {foundExcelCount}/{excelBase.length} ({excelBase.length > 0 ? Math.round((foundExcelCount / excelBase.length) * 100) : 0}%)
              </span>
            </div>
          </div>
        )}
      </div>

      <div className="relative bg-black aspect-[3/4] w-full overflow-hidden flex items-center justify-center">
        {/* Reader element - always kept mounted in DOM */}
        <div id="reader" className={`w-full h-full [&>video]:object-cover [&>video]:w-full [&>video]:h-full ${!isCameraActive || cameraError ? 'invisible' : ''}`} />

        {/* 1. Camera error / Permission Denied state */}
        {cameraError && (
          <div className="absolute inset-0 z-10 bg-neutral-900/95 flex flex-col items-center justify-center p-6 text-center animate-in fade-in duration-200">
            <div className="w-14 h-14 rounded-full bg-amber-500/10 border border-amber-500/30 flex items-center justify-center mb-3">
              <CameraOff className="h-7 w-7 text-amber-400" />
            </div>
            <h4 className="text-white font-bold text-base mb-1">Câmera Indisponível ou Permissão Negada</h4>
            <p className="text-neutral-300 text-xs max-w-xs mb-5 leading-relaxed">
              O navegador não concedeu acesso à câmera. Permita o acesso clicando no ícone de permissão na barra de endereços do navegador, ou utilize as opções abaixo:
            </p>
            <div className="flex flex-wrap gap-2 justify-center">
              <Button 
                onClick={startScanner}
                className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold px-4 py-2 rounded-full shadow-lg"
              >
                <Camera className="h-4 w-4 mr-1.5" />
                Permitir / Tentar Novamente
              </Button>
              <Button 
                variant="outline" 
                onClick={openManualModal}
                className="bg-white/10 text-white border-white/20 hover:bg-white/20 text-xs px-4 py-2 rounded-full"
              >
                Digitar Lote
              </Button>
              <Button 
                variant="outline" 
                onClick={() => fileInputRef.current?.click()}
                className="bg-white/10 text-white border-white/20 hover:bg-white/20 text-xs px-4 py-2 rounded-full"
              >
                <Upload className="h-4 w-4 mr-1.5" />
                Galeria
              </Button>
            </div>
          </div>
        )}

        {/* 2. Standby UI when camera is turned off voluntarily for power saving */}
        {!isCameraActive && !cameraError && (
          <div className="absolute inset-0 z-10 bg-neutral-900/95 flex flex-col items-center justify-center p-6 text-center animate-in fade-in duration-200">
            <div className="w-14 h-14 rounded-full bg-neutral-800 border border-neutral-700 flex items-center justify-center mb-3">
              <CameraOff className="h-7 w-7 text-amber-400" />
            </div>
            <h4 className="text-white font-semibold text-base mb-1">Câmera em Modo Economia</h4>
            <p className="text-neutral-400 text-xs max-w-xs mb-5">
              Câmera desligada para economizar bateria. Você pode ligá-la ou digitar o lote manualmente.
            </p>
            <div className="flex flex-wrap gap-2 justify-center">
              <Button 
                onClick={startScanner}
                className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold px-4 py-2 rounded-full shadow-lg"
              >
                <Camera className="h-4 w-4 mr-2" />
                Ligar Câmera
              </Button>
              <Button 
                variant="outline" 
                onClick={openManualModal}
                className="bg-white/10 text-white border-white/20 hover:bg-white/20 text-xs px-4 py-2 rounded-full"
              >
                Digitar Lote
              </Button>
            </div>
          </div>
        )}
        
        <input 
          type="file" 
          accept="image/*" 
          capture="environment"
          ref={fileInputRef} 
          onChange={handleFileUpload} 
          className="hidden" 
        />

        {/* Small Camera ON/OFF toggle button in top-right of camera box */}
        <button
          type="button"
          onClick={toggleCamera}
          className={`absolute top-4 right-4 z-20 flex items-center gap-1.5 px-3 py-1.5 rounded-full backdrop-blur-md text-xs font-semibold shadow-lg border transition-all ${
            isCameraActive
              ? 'bg-emerald-600/85 hover:bg-emerald-600 text-white border-emerald-400/40'
              : 'bg-neutral-800/90 hover:bg-neutral-700 text-amber-300 border-amber-500/40'
          }`}
          title={isCameraActive ? "Desligar câmera para economizar energia" : "Ligar câmera"}
        >
          {isCameraActive ? (
            <>
              <Camera className="h-3.5 w-3.5" />
              <span>Câmera ON</span>
            </>
          ) : (
            <>
              <CameraOff className="h-3.5 w-3.5 text-amber-400" />
              <span>Câmera OFF</span>
            </>
          )}
        </button>
        
        {/* Overlay instructions when camera is active */}
        {isCameraActive && (
          <div className="absolute inset-x-0 top-4 left-4 right-auto flex pointer-events-none z-10">
            <div className="bg-black/60 text-white px-3 py-1.5 rounded-full backdrop-blur-md text-xs font-medium flex items-center shadow-lg border border-white/10">
              <ScanLine className="h-3.5 w-3.5 mr-1.5" />
              Auto-Scan (Iniciados em 5)
            </div>
          </div>
        )}

        {/* Bottom Actions */}
        <div className="absolute bottom-6 left-0 right-0 flex justify-center gap-3 z-10 px-4">
          <button 
            onClick={openManualModal}
            className="flex-1 max-w-[210px] h-12 rounded-full flex items-center justify-center transition-transform shadow-xl font-semibold text-xs sm:text-sm bg-white/20 border-2 border-white text-white active:scale-95 backdrop-blur-md"
          >
            Digitar Lote Manualmente
          </button>
          <button 
            onClick={() => fileInputRef.current?.click()}
            className="h-12 w-12 rounded-full bg-white/10 border-2 border-white/50 flex items-center justify-center active:scale-95 transition-transform backdrop-blur-md"
            title="Enviar foto da galeria"
          >
            <Upload className="h-5 w-5 text-white" />
          </button>
        </div>
      </div>

      <div className="flex-1 bg-white p-4 overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-neutral-900">Etiquetas Lidas ({scans.length})</h3>
          </div>
          {scans.length > 0 && (
            <div className="flex items-center gap-2">
              <Button 
                variant="outline" 
                size="sm" 
                onClick={async () => {
                  try {
                    await saveInventoryReport(scans);
                    alert("Relatório deste inventário salvo no histórico permanente com sucesso!");
                  } catch (e) {
                    console.error(e);
                    alert("Erro ao salvar relatório.");
                  }
                }} 
                className="text-[#009988] border-[#009988]/30 hover:bg-[#009988]/10 text-xs font-semibold flex items-center gap-1.5 h-8"
              >
                <Save className="h-3.5 w-3.5" />
                Salvar Relatório
              </Button>
              <Button variant="ghost" size="sm" onClick={clearAll} className="text-red-500 hover:text-red-600 hover:bg-red-50 text-xs h-8">
                Limpar Tudo
              </Button>
            </div>
          )}
        </div>
        
        <div className="space-y-3 pb-12">
          {scans.length === 0 ? (
            <div className="text-center text-neutral-400 py-8">
              Nenhuma etiqueta escaneada ainda.
            </div>
          ) : (
            scans.map(scan => (
              <Card 
                key={scan.id} 
                id={`item-${scan.id}`}
                className={`p-4 shadow-sm border relative transition-all duration-300 ${
                  highlightedId === scan.id 
                    ? 'border-red-500 ring-4 ring-red-400/50 bg-red-50/60 scale-[1.02]' 
                    : 'border-neutral-100 bg-white'
                }`}
              >
                <div className="absolute top-2 right-2">
                  <Button variant="ghost" size="icon" onClick={() => deleteItem(scan.id)} className="h-6 w-6">
                    <Trash2 className="h-4 w-4 text-neutral-400 hover:text-red-500" />
                  </Button>
                </div>
                <div className="mb-2">
                  <div className="flex flex-wrap gap-1.5 mb-1.5 items-center">
                    <span className="inline-block bg-[#2941CC]/10 text-[#2941CC] font-bold px-2 py-0.5 rounded text-xs">
                      {scan.composto || 'SEM KATAME'}
                    </span>
                    <span className="inline-block bg-emerald-100 text-emerald-800 font-bold px-2 py-0.5 rounded text-xs">
                      {scan.unidade || 'SEM LOCAL'}
                    </span>
                    {scan.statusConferencia === 'ENCONTRADO' && (
                      <span className="inline-block bg-emerald-50 text-emerald-700 border border-emerald-200 font-bold px-1.5 py-0.5 rounded text-[10px]">
                        ✓ EXCEL OK
                      </span>
                    )}
                    {scan.statusConferencia === 'FORA_DA_LISTA' && (
                      <span className="inline-block bg-amber-50 text-amber-700 border border-amber-200 font-bold px-1.5 py-0.5 rounded text-[10px]">
                        ⚠️ FORA DA LISTA
                      </span>
                    )}
                  </div>
                  <p className="font-mono text-lg font-semibold text-neutral-900">{scan.lote || 'Sem Lote'}</p>
                  {(scan.pesoTeorico || scan.pesoReal) && (
                    <div className="flex gap-3 text-xs text-neutral-600 mt-1">
                      {scan.pesoTeorico && <span>Teór: <strong>{scan.pesoTeorico} kg</strong></span>}
                      {scan.pesoReal && <span>Real: <strong>{scan.pesoReal} kg</strong></span>}
                    </div>
                  )}
                </div>
                <p className="text-[10px] text-neutral-400 mt-3 pt-2 border-t border-neutral-100">
                  Capturado em: {scan.scannedAt?.toDate() ? scan.scannedAt.toDate().toLocaleTimeString('pt-BR') : '...'}
                </p>
              </Card>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

