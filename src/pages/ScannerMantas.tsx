import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  ArrowLeft, Trash2, Download, Mail, ScanLine, Camera, CameraOff, 
  Upload, Scale, Sparkles, AlertTriangle 
} from 'lucide-react';
import { 
  collection, addDoc, query, orderBy, onSnapshot, deleteDoc, 
  doc, serverTimestamp, getDocs 
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import Papa from 'papaparse';
import { Html5Qrcode } from 'html5-qrcode';

interface MantaScanItem {
  id: string;
  lote: string;
  composto: string; // Katame
  peso: string;    // Peso em kg
  scannedAt?: any;
}

interface DuplicateInfo {
  id?: string;
  lote: string;
  composto?: string;
  peso?: string;
  scannedAt?: any;
}

export const formatMantaLote = (lote?: string): string => {
  if (!lote) return '';
  const s = String(lote).trim();
  if (s.startsWith('1') && s.length === 7) {
    return s.slice(1);
  }
  return s;
};

export function ScannerMantas() {
  const navigate = useNavigate();
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const isModalOpenRef = useRef(false);
  const isStartingRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pesoInputRef = useRef<HTMLInputElement>(null);

  // Scans state + Ref for closure-safe live duplicate checking
  const [scans, setScans] = useState<MantaScanItem[]>([]);
  const scansRef = useRef<MantaScanItem[]>([]);
  const lastScanTimeRef = useRef<{ code: string; time: number }>({ code: '', time: 0 });

  const [isReading, setIsReading] = useState(false);
  const [cameraError, setCameraError] = useState(false);
  const [isCameraActive, setIsCameraActive] = useState(true);

  // Modal states: 'none' | 'manual' | 'katame' | 'peso'
  const [activeModal, setActiveModal] = useState<'none' | 'manual' | 'katame' | 'peso'>('none');
  const [currentBarcode, setCurrentBarcode] = useState('');
  const [katameInput, setKatameInput] = useState('REBK');
  const [pesoInput, setPesoInput] = useState('');
  const [manualBarcode, setManualBarcode] = useState('');
  const [duplicateError, setDuplicateError] = useState(false);

  // Duplicate blocking modal & list item highlighting
  const [duplicateModal, setDuplicateModal] = useState<DuplicateInfo | null>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);

  // Modals para apagar
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<string | null>(null);

  // Standard Katames list
  const katames = ["REBK", "RETBK978", "RET", "RESW", "REL", "REP", "RETBSW", "RETB2", "RETB3", "RETB4", "RETBA", "RETK", "REK367"];

  // Keep scansRef in sync with scans state
  useEffect(() => {
    scansRef.current = scans;
  }, [scans]);

  // Audio Beep for success
  const playBeep = () => {
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const oscillator = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();
      
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(850, audioCtx.currentTime); // 850Hz beep
      
      gainNode.gain.setValueAtTime(0, audioCtx.currentTime);
      gainNode.gain.linearRampToValueAtTime(1, audioCtx.currentTime + 0.01);
      gainNode.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.15);
      
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

  // Duplicate lookup helper (checks both LOTE and COMPOSTO)
  const checkMantaDuplicate = (loteTarget: string, compostoTarget: string) => {
    const normLote = formatMantaLote(loteTarget);
    const normComposto = String(compostoTarget || '').trim().toUpperCase();
    return scansRef.current.find(s => 
      formatMantaLote(s.lote) === normLote && 
      String(s.composto || '').trim().toUpperCase() === normComposto
    );
  };

  // Sync modal state to ref for scanner callback
  useEffect(() => {
    isModalOpenRef.current = activeModal !== 'none';
    if (activeModal === 'none') {
      setDuplicateError(false);
    }
    if (activeModal === 'peso') {
      setTimeout(() => {
        pesoInputRef.current?.focus();
      }, 100);
    }
  }, [activeModal]);

  // Firestore Real-time listener for mantas_scans
  useEffect(() => {
    const q = query(collection(db, 'mantas_scans'), orderBy('scannedAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const items: MantaScanItem[] = [];
      snapshot.forEach((docSnap) => {
        items.push({ id: docSnap.id, ...docSnap.data({ serverTimestamps: 'estimate' }) } as MantaScanItem);
      });
      setScans(items);
      try {
        localStorage.setItem('katame_mantas_scans', JSON.stringify(items));
      } catch (e) {
        console.error(e);
      }
    }, (error) => {
      console.error("Firestore mantas error, falling back to local:", error);
      const saved = localStorage.getItem('katame_mantas_scans');
      if (saved) {
        try {
          setScans(JSON.parse(saved));
        } catch (e) {}
      }
    });

    return () => unsubscribe();
  }, []);

  // Camera scanner methods
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
        if (isModalOpenRef.current) return;

        const cleanText = decodedText.trim();
        // In mantas: barcode MUST have exactly 7 characters AND start with '1'
        if (cleanText.length !== 7 || !cleanText.startsWith('1')) return;

        // O número 1 deve ficar oculto na leitura e no lançamento manual
        const loteSem1 = cleanText.slice(1);

        // Anti-spam debounce (ignore same code within 1.5s)
        const now = Date.now();
        if (lastScanTimeRef.current.code === loteSem1 && now - lastScanTimeRef.current.time < 1500) {
          return;
        }
        lastScanTimeRef.current = { code: loteSem1, time: now };

        playBeep();
        setIsReading(false);
        setCurrentBarcode(loteSem1);
        setActiveModal('katame');
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
        // If device constraint error (e.g. desktop/laptop has no back camera), fallback to default/user camera
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
      console.warn("Camera permission or access notice (Mantas):", err?.name || err?.message || err);
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
    const scanner = new Html5Qrcode("reader-mantas");
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

  // Manual modal handlers
  const openManualModal = () => {
    setManualBarcode('');
    setActiveModal('manual');
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    let finalBarcode = manualBarcode.trim();

    // Se o usuário digitou 7 caracteres iniciando com 1, remove o 1
    if (finalBarcode.length === 7 && finalBarcode.startsWith('1')) {
      finalBarcode = finalBarcode.slice(1);
    }

    if (finalBarcode.length !== 6) {
      alert("O lote da manta deve ter 6 caracteres (o número 1 inicial é ocultado).");
      return;
    }

    playBeep();
    setCurrentBarcode(finalBarcode);
    setActiveModal('katame');
  };

  // File upload from gallery
  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !scannerRef.current) return;

    try {
      setIsReading(true);
      const decodedText = await scannerRef.current.scanFile(file, true);
      const cleanText = decodedText.trim();

      if (cleanText.length !== 7 || !cleanText.startsWith('1')) {
        alert("O código de barras da manta deve conter exatamente 7 caracteres e iniciar com o número 1.");
        return;
      }

      const loteSem1 = cleanText.slice(1);

      playBeep();
      setCurrentBarcode(loteSem1);
      setActiveModal('katame');
    } catch (err) {
      console.error(err);
      alert("Nenhum código de barras legível encontrado na imagem.");
    } finally {
      setIsReading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Step 1: Katame submit -> verifies duplicate (Lote + Katame) before advancing to Step 2: Peso
  const handleKatameSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanKatame = katameInput.trim().toUpperCase();
    if (!cleanKatame) {
      alert("Por favor, digite ou selecione o Katame.");
      return;
    }
    setKatameInput(cleanKatame);

    // Checagem de Duplicidade: Executada APÓS a seleção do composto
    // (Pode haver lotes iguais com compostos diferentes, mas se Lote + Composto forem iguais, bloqueia)
    const existing = checkMantaDuplicate(currentBarcode, cleanKatame);
    if (existing) {
      playDuplicateBuzzer();
      setDuplicateModal({
        id: existing.id,
        lote: formatMantaLote(existing.lote),
        composto: existing.composto,
        peso: existing.peso,
        scannedAt: existing.scannedAt
      });
      return;
    }

    setActiveModal('peso');
  };

  // Step 2: Save Manta (Lote + Katame + Peso)
  const handleSaveManta = async (e: React.FormEvent) => {
    e.preventDefault();
    setDuplicateError(false);

    const cleanPeso = pesoInput.trim().replace(',', '.');
    if (!cleanPeso) {
      alert("Por favor, informe o peso da manta.");
      return;
    }

    const numPeso = parseFloat(cleanPeso);
    if (isNaN(numPeso) || numPeso <= 0) {
      alert("Por favor, informe um peso numérico válido maior que zero.");
      return;
    }

    // Robust Duplicate Check pre-save (Lote + Katame)
    const existing = checkMantaDuplicate(currentBarcode, katameInput);
    if (existing) {
      playDuplicateBuzzer();
      closeModalAndResume();
      setDuplicateModal({
        id: existing.id,
        lote: formatMantaLote(existing.lote),
        composto: existing.composto,
        peso: existing.peso,
        scannedAt: existing.scannedAt
      });
      return;
    }

    try {
      await addDoc(collection(db, 'mantas_scans'), {
        lote: currentBarcode,
        composto: katameInput.trim().toUpperCase(),
        peso: cleanPeso,
        scannedAt: serverTimestamp()
      });

      closeModalAndResume();
    } catch (err) {
      console.error("Erro ao salvar manta no Firestore:", err);
      // Fallback local
      const newScan: MantaScanItem = {
        id: crypto.randomUUID(),
        lote: currentBarcode,
        composto: katameInput.trim().toUpperCase(),
        peso: cleanPeso,
        scannedAt: new Date()
      };
      setScans(prev => [newScan, ...prev]);
      closeModalAndResume();
    }
  };

  const closeModalAndResume = () => {
    setActiveModal('none');
    // Keep Katame in memory (do not reset katameInput)
    // Reset peso for next entry:
    setPesoInput('');
    setCurrentBarcode('');
  };

  // Delete item
  const confirmDelete = async () => {
    if (itemToDelete) {
      try {
        await deleteDoc(doc(db, 'mantas_scans', itemToDelete));
      } catch (e) {
        console.error(e);
      }
      setScans(prev => prev.filter(s => s.id !== itemToDelete));
      setItemToDelete(null);
    }
  };

  // Clear all
  const confirmClearAll = async () => {
    setShowClearConfirm(false);
    try {
      const q = query(collection(db, 'mantas_scans'));
      const querySnapshot = await getDocs(q);
      const deletePromises = querySnapshot.docs.map((docSnap) => 
        deleteDoc(doc(db, 'mantas_scans', docSnap.id))
      );
      await Promise.all(deletePromises);
    } catch (e) {
      console.error(e);
    }
    setScans([]);
    localStorage.removeItem('katame_mantas_scans');
  };

  // Export CSV
  const exportCSV = () => {
    const csvData = scans.map(s => ({
      'Lote (Barcode)': formatMantaLote(s.lote),
      'Composto (Katame)': s.composto || '',
      'Peso (kg)': s.peso || '',
      'Data/Hora': s.scannedAt?.toDate ? s.scannedAt.toDate().toLocaleString('pt-BR') : new Date().toLocaleString('pt-BR')
    }));
    const csv = Papa.unparse(csvData);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `inventario_mantas_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Send Email
  const sendEmail = () => {
    const csvData = scans.map(s => ({
      'Lote (Barcode)': formatMantaLote(s.lote),
      'Composto (Katame)': s.composto || '',
      'Peso (kg)': s.peso || '',
      'Data/Hora': s.scannedAt?.toDate ? s.scannedAt.toDate().toLocaleString('pt-BR') : new Date().toLocaleString('pt-BR')
    }));
    const csv = Papa.unparse(csvData);
    const subject = encodeURIComponent("Inventário de Mantas Katame");
    const body = encodeURIComponent("Segue os dados do inventário de mantas coletados pelo app:\n\n" + csv);
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
  };

  // Calculate total weight
  const totalWeight = scans.reduce((acc, curr) => {
    const val = parseFloat(curr.peso || '0');
    return acc + (isNaN(val) ? 0 : val);
  }, 0);

  return (
    <div className="min-h-screen bg-[#eeeeee] flex flex-col max-w-lg mx-auto shadow-xl relative">
      
      {/* MODAL DE BLOQUEIO DE DUPLICIDADE */}
      {duplicateModal && (
        <div className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-4 backdrop-blur-md animate-in fade-in duration-200">
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
                <span className="font-bold text-[#009988] bg-[#009988]/10 px-2 py-0.5 rounded">
                  {duplicateModal.composto || 'NÃO INFORMADO'}
                </span>
              </div>
              {duplicateModal.peso && (
                <div className="flex justify-between items-center text-xs">
                  <span className="text-neutral-500 font-medium">Peso Registrado:</span>
                  <span className="font-bold text-purple-700 bg-purple-100 px-2 py-0.5 rounded">
                    {duplicateModal.peso} kg
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
                onClick={() => setDuplicateModal(null)}
                className="w-full bg-red-600 hover:bg-red-700 text-white font-bold py-3 rounded-xl shadow-lg"
              >
                Entendido / Descartar Leitura
              </Button>
              {duplicateModal.id && (
                <Button
                  variant="outline"
                  onClick={() => {
                    const id = duplicateModal.id;
                    setDuplicateModal(null);
                    setHighlightedId(id);
                    setTimeout(() => {
                      const el = document.getElementById(`item-${id}`);
                      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }, 150);
                    setTimeout(() => setHighlightedId(null), 4000);
                  }}
                  className="w-full border-neutral-300 text-neutral-700 text-xs py-2"
                >
                  Localizar Registro na Lista
                </Button>
              )}
            </div>
          </Card>
        </div>
      )}

      {/* Delete Item Confirmation Modal */}
      {itemToDelete && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 backdrop-blur-sm">
          <Card className="w-full max-w-sm p-6 bg-white animate-in fade-in zoom-in duration-200">
            <h3 className="text-xl font-bold text-neutral-900 mb-2">Remover Manta?</h3>
            <p className="text-neutral-500 mb-6 text-sm">Tem certeza que deseja apagar este registro de manta?</p>
            <div className="flex gap-3 justify-end">
              <Button variant="outline" onClick={() => setItemToDelete(null)} className="flex-1">Cancelar</Button>
              <Button onClick={confirmDelete} className="flex-1 bg-red-500 hover:bg-red-600 text-white">Apagar</Button>
            </div>
          </Card>
        </div>
      )}

      {/* Clear All Confirmation Modal */}
      {showClearConfirm && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 backdrop-blur-sm">
          <Card className="w-full max-w-sm p-6 bg-white animate-in fade-in zoom-in duration-200 shadow-2xl">
            <h3 className="text-xl font-bold text-neutral-900 mb-2">Apagar todas as mantas?</h3>
            <p className="text-neutral-600 text-sm mb-6">
              Você tem <strong>{scans.length} mantas</strong> registradas ({totalWeight.toFixed(2)} kg). Tem certeza que deseja remover todos os registros?
            </p>
            <div className="flex gap-3 justify-end">
              <Button variant="outline" onClick={() => setShowClearConfirm(false)} className="flex-1">Cancelar</Button>
              <Button onClick={confirmClearAll} className="flex-1 bg-red-500 hover:bg-red-600 text-white">Apagar Tudo</Button>
            </div>
          </Card>
        </div>
      )}

      {/* MODAL 1: Digitar Lote Manualmente */}
      {activeModal === 'manual' && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 backdrop-blur-sm">
          <Card className="w-full max-w-sm p-6 bg-white animate-in fade-in zoom-in duration-200 shadow-2xl">
            <form onSubmit={handleManualSubmit}>
              <h3 className="text-xl font-bold text-neutral-900 mb-2">Entrada Manual (Manta)</h3>
              <p className="text-xs text-neutral-500 mb-5">
                Digite os <strong>6 caracteres</strong> do lote da manta (o número <strong>1</strong> inicial fica oculto).
              </p>
              
              <div className="space-y-4 mb-6">
                <div>
                  <label className="block text-xs font-bold text-neutral-700 uppercase tracking-wider mb-1.5">
                    Código do Lote (1 Oculto)
                  </label>
                  <div className="flex items-center">
                    <div className="bg-neutral-100 border border-r-0 border-neutral-300 rounded-l-lg px-3.5 py-3 text-lg font-mono font-bold text-neutral-400 select-none">
                      1
                    </div>
                    <input
                      type="text"
                      maxLength={7}
                      value={manualBarcode}
                      onChange={(e) => {
                        let val = e.target.value.trim();
                        if (val.length === 7 && val.startsWith('1')) {
                          val = val.slice(1);
                        }
                        setManualBarcode(val.slice(0, 6));
                      }}
                      placeholder="Ex: 101010"
                      autoFocus
                      className="w-full border border-neutral-300 rounded-r-lg p-3 text-lg font-mono font-bold tracking-widest text-neutral-900 focus:ring-2 focus:ring-[#009988] focus:border-[#009988] outline-none"
                    />
                  </div>
                  <div className="flex justify-between items-center text-[11px] text-neutral-400 mt-1.5">
                    <span>O número 1 inicial é ocultado.</span>
                    <span className={`font-mono font-bold ${manualBarcode.length === 6 ? 'text-[#009988]' : 'text-neutral-500'}`}>
                      {manualBarcode.length}/6
                    </span>
                  </div>
                </div>
              </div>
              
              <div className="flex gap-3 justify-end">
                <Button type="button" variant="outline" onClick={() => setActiveModal('none')} className="flex-1">
                  Cancelar
                </Button>
                <Button 
                  type="submit" 
                  disabled={manualBarcode.trim().length !== 6}
                  className="flex-1 bg-[#009988] hover:bg-[#008877] text-white font-semibold disabled:opacity-50"
                >
                  Avançar
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}

      {/* MODAL 2: Selecionar Katame */}
      {activeModal === 'katame' && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 backdrop-blur-sm">
          <Card className="w-full max-w-sm p-6 bg-white animate-in fade-in zoom-in duration-200 shadow-2xl">
            <form onSubmit={handleKatameSubmit}>
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-lg font-bold text-neutral-900">Etapa 1: Katame</h3>
                <span className="text-xs font-semibold px-2 py-0.5 rounded bg-[#009988]/10 text-[#009988]">Passo 1 de 2</span>
              </div>
              
              {/* Scanned Barcode badge & Selected Katame */}
              <div className="bg-neutral-100 p-3 rounded-xl border border-neutral-200 mb-4 flex items-center justify-between">
                <div>
                  <span className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider block">Lote Lido</span>
                  <span className="font-mono text-base font-bold text-neutral-900">{currentBarcode}</span>
                </div>
                <div className="text-right">
                  <span className="text-[10px] font-bold text-[#009988] uppercase tracking-wider block">Katame</span>
                  <span className="text-base font-black text-[#009988]">{katameInput || 'Nenhum'}</span>
                </div>
              </div>
              
              <div className="mb-6">
                <label className="block text-xs font-bold text-neutral-700 uppercase tracking-wider mb-2.5">
                  Toque para selecionar o Katame:
                </label>
                
                {/* Larger, comfortable touch grid */}
                <div className="grid grid-cols-3 gap-2 max-h-64 overflow-y-auto p-1.5 border border-neutral-200 rounded-xl bg-neutral-50/70">
                  {katames.map((k) => {
                    const isSelected = katameInput === k;
                    return (
                      <button
                        type="button"
                        key={k}
                        onClick={() => setKatameInput(k)}
                        className={`h-12 text-sm sm:text-base rounded-xl font-bold transition-all flex items-center justify-center border active:scale-95 ${
                          isSelected
                            ? 'bg-[#009988] text-white shadow-md border-[#008877] ring-2 ring-[#009988]/30'
                            : 'bg-white text-neutral-800 border-neutral-200 hover:border-[#009988] hover:bg-emerald-50/50 shadow-sm'
                        }`}
                      >
                        {k}
                      </button>
                    );
                  })}
                </div>
              </div>
              
              <div className="flex gap-3 justify-end">
                <Button type="button" variant="outline" onClick={closeModalAndResume} className="flex-1 py-2.5">
                  Cancelar
                </Button>
                <Button 
                  type="submit" 
                  disabled={!katameInput}
                  className="flex-1 bg-[#009988] hover:bg-[#008877] text-white font-semibold py-2.5 shadow-md disabled:opacity-50"
                >
                  Próximo: Peso →
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}

      {/* MODAL 3: Digitar Peso da Manta */}
      {activeModal === 'peso' && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 backdrop-blur-sm">
          <Card className="w-full max-w-sm p-6 bg-white animate-in fade-in zoom-in duration-200 shadow-2xl">
            <form onSubmit={handleSaveManta}>
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-lg font-bold text-neutral-900 flex items-center gap-1.5">
                  <Scale className="h-5 w-5 text-[#009988]" />
                  Etapa 2: Peso da Manta
                </h3>
                <span className="text-xs font-semibold px-2 py-0.5 rounded bg-[#009988]/10 text-[#009988]">Passo 2 de 2</span>
              </div>
              
              {/* Summary of Barcode and Katame */}
              <div className="grid grid-cols-2 gap-2 mb-5">
                <div className="bg-neutral-100 p-2.5 rounded-lg border border-neutral-200">
                  <span className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider block">Lote</span>
                  <span className="font-mono text-sm font-bold text-neutral-900 line-clamp-1">{currentBarcode}</span>
                </div>
                <div className="bg-[#009988]/10 p-2.5 rounded-lg border border-[#009988]/20">
                  <span className="text-[10px] font-bold text-[#009988] uppercase tracking-wider block">Katame</span>
                  <span className="text-sm font-extrabold text-[#009988]">{katameInput}</span>
                </div>
              </div>

              {duplicateError && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-lg text-xs font-semibold mb-4">
                  ⚠️ DUPLICIDADE DETECTADA: Esta manta já foi registrada com este lote, katame e peso!
                </div>
              )}
              
              <div className="space-y-4 mb-6">
                <div>
                  <label className="block text-xs font-bold text-neutral-700 uppercase tracking-wider mb-1.5">
                    Digite o Peso (em kg)
                  </label>
                  <div className="relative">
                    <input
                      ref={pesoInputRef}
                      type="number"
                      step="any"
                      inputMode="decimal"
                      value={pesoInput}
                      onChange={(e) => setPesoInput(e.target.value)}
                      placeholder="Ex: 25.5"
                      autoFocus
                      required
                      className="w-full border border-neutral-300 rounded-lg p-3 text-2xl font-bold font-mono text-neutral-900 focus:ring-2 focus:ring-[#009988] focus:border-[#009988] outline-none pr-12"
                    />
                    <span className="absolute right-4 top-3.5 text-sm font-bold text-neutral-400 pointer-events-none">
                      kg
                    </span>
                  </div>
                  <p className="text-[11px] text-neutral-400 mt-1.5">
                    Use ponto ou vírgula para casas decimais (ex: 18.25 ou 24.5).
                  </p>
                </div>
              </div>
              
              <div className="flex gap-3 justify-end">
                <Button type="button" variant="outline" onClick={() => setActiveModal('katame')} className="flex-1">
                  ← Voltar
                </Button>
                <Button type="submit" className="flex-1 bg-[#009988] hover:bg-[#008877] text-white font-bold shadow-md">
                  Salvar Manta
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}
      
      {/* Header */}
      <header className="bg-white p-4 flex items-center justify-between border-b border-neutral-200 z-10 relative">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate('/')}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h2 className="font-semibold text-lg text-neutral-900">Scanner Mantas</h2>
          </div>
        </div>
        <div className="flex gap-2 items-center">
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
            <Download className="h-5 w-5 text-[#009988]" />
          </Button>
          <Button variant="ghost" size="icon" onClick={sendEmail} title="Enviar por Email">
            <Mail className="h-5 w-5 text-[#009988]" />
          </Button>
        </div>
      </header>

      {/* Camera Viewport */}
      <div className="relative bg-black aspect-[3/4] w-full overflow-hidden flex items-center justify-center">
        {/* Html5Qrcode reader element */}
        <div 
          id="reader-mantas" 
          className={`w-full h-full [&>video]:object-cover [&>video]:w-full [&>video]:h-full ${!isCameraActive || cameraError ? 'invisible' : ''}`} 
        />

        {/* Small Camera ON/OFF toggle button in top-right */}
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

        {/* 1. Camera Error / Permission Denied State */}
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

        {/* Overlay instructions when camera is active */}
        {isCameraActive && (
          <div className="absolute inset-x-0 top-4 left-4 right-auto flex pointer-events-none z-10">
            <div className="bg-black/60 text-white px-3 py-1.5 rounded-full backdrop-blur-md text-xs font-medium flex items-center shadow-lg border border-white/10">
              <ScanLine className="h-3.5 w-3.5 mr-1.5" />
              Auto-Scan Manta (Inicia com 1)
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

      {/* List of Scanned Mantas */}
      <div className="flex-1 bg-white p-4 overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-semibold text-neutral-900">Mantas Lidas ({scans.length})</h3>
            {scans.length > 0 && (
              <p className="text-xs text-neutral-500 mt-0.5">
                Peso Total: <strong className="text-[#009988] font-bold">{totalWeight.toFixed(2)} kg</strong>
              </p>
            )}
          </div>
          {scans.length > 0 && (
            <Button variant="ghost" size="sm" onClick={() => setShowClearConfirm(true)} className="text-red-500 hover:text-red-600 hover:bg-red-50 text-xs">
              Limpar Lista
            </Button>
          )}
        </div>
        
        <div className="space-y-3 pb-12">
          {scans.length === 0 ? (
            <div className="text-center text-neutral-400 py-12">
              <Scale className="h-8 w-8 mx-auto mb-2 text-neutral-300" />
              Nenhuma manta registrada ainda.
              <p className="text-xs text-neutral-400 mt-1">
                Aponte a câmera para o 1º barcode da manta ou clique em "Digitar Lote Manualmente".
              </p>
            </div>
          ) : (
            scans.map((scan, idx) => (
              <Card 
                key={scan.id || idx} 
                id={`item-${scan.id}`}
                className={`p-4 shadow-sm border relative transition-all duration-300 ${
                  highlightedId === scan.id 
                    ? 'border-red-500 ring-4 ring-red-400/50 bg-red-50/60 scale-[1.02]' 
                    : 'border-neutral-100 bg-white'
                }`}
              >
                <div className="absolute top-3 right-3">
                  <Button variant="ghost" size="icon" onClick={() => setItemToDelete(scan.id)} className="h-6 w-6">
                    <Trash2 className="h-4 w-4 text-neutral-400 hover:text-red-500" />
                  </Button>
                </div>

                <div className="mb-2">
                  <div className="flex flex-wrap items-center gap-2 mb-1.5">
                    <span className="inline-block bg-[#009988]/10 text-[#009988] font-bold px-2.5 py-0.5 rounded text-xs">
                      {scan.composto || 'SEM KATAME'}
                    </span>
                    <span className="inline-block bg-purple-100 text-purple-800 font-extrabold px-2.5 py-0.5 rounded text-xs flex items-center gap-1">
                      <Scale className="h-3 w-3" />
                      {scan.peso} kg
                    </span>
                  </div>
                  <p className="font-mono text-lg font-bold text-neutral-900">{formatMantaLote(scan.lote) || 'Sem Lote'}</p>
                </div>

                <p className="text-[10px] text-neutral-400 mt-2 pt-2 border-t border-neutral-100">
                  Capturado em: {scan.scannedAt?.toDate ? scan.scannedAt.toDate().toLocaleTimeString('pt-BR') : new Date().toLocaleTimeString('pt-BR')}
                </p>
              </Card>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
