import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  ArrowLeft, Trash2, Download, Mail, ScanLine, Camera, CameraOff, 
  Upload, Scale, Sparkles 
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

export function ScannerMantas() {
  const navigate = useNavigate();
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const isModalOpenRef = useRef(false);
  const isStartingRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pesoInputRef = useRef<HTMLInputElement>(null);

  const [scans, setScans] = useState<MantaScanItem[]>([]);
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

  // Modals para apagar
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<string | null>(null);

  // Standard Katames list
  const katames = ["REBK", "RETBK978", "RET", "RESW", "REL", "REP", "RETBSW", "RETB2", "RETB3", "RETB4", "RETBA", "RETK", "REK367"];

  // Audio Beep
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
        return;
      }
      isStartingRef.current = true;
      setCameraError(false);
      await scannerRef.current.start(
        { facingMode: "environment" },
        { 
          fps: 15, 
          qrbox: { width: 320, height: 160 } 
        },
        (decodedText) => {
          if (isModalOpenRef.current) return;

          const cleanText = decodedText.trim();
          // Only accept barcodes with 11 or 12 numeric digits
          if (!/^\d{11,12}$/.test(cleanText)) return;

          // Check if starts with 5
          const isAutoMatch = cleanText.startsWith('5');
          if (isAutoMatch) {
            playBeep();
            setIsReading(false);
            setCurrentBarcode(cleanText);
            setActiveModal('katame');
          }
        },
        () => {}
      );
      setIsCameraActive(true);
    } catch (err) {
      console.error("Camera access error:", err);
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

      if (!/^\d{11,12}$/.test(cleanText)) {
        alert("O código de barras da imagem deve conter apenas números (11 ou 12 dígitos).");
        return;
      }

      let finalBarcode = cleanText;
      if (finalBarcode.length === 11 && !finalBarcode.startsWith('5')) {
        finalBarcode = '5' + finalBarcode;
      }

      if (!finalBarcode.startsWith('5')) {
        alert("O código de barras da manta deve começar com o número 5.");
        return;
      }

      playBeep();
      setCurrentBarcode(finalBarcode);
      setActiveModal('katame');
    } catch (err) {
      console.error(err);
      alert("Nenhum código de barras legível encontrado na imagem.");
    } finally {
      setIsReading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Step 1: Katame submit -> advances to Step 2: Peso
  const handleKatameSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanKatame = katameInput.trim().toUpperCase();
    if (!cleanKatame) {
      alert("Por favor, digite ou selecione o Katame.");
      return;
    }
    setKatameInput(cleanKatame);
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

    // Check duplicate
    const isDuplicate = scans.some(scan => 
      String(scan.lote || '').trim() === currentBarcode.trim() && 
      String(scan.composto || '').trim().toUpperCase() === katameInput.trim().toUpperCase() &&
      String(scan.peso || '').trim() === cleanPeso
    );

    if (isDuplicate) {
      setDuplicateError(true);
      alert("⚠️ DUPLICIDADE DETECTADA: Esta manta já foi registrada com este lote, katame e peso!");
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
      'Lote (Barcode)': s.lote || '',
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
      'Lote (Barcode)': s.lote || '',
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
                Digite os 11 números após o "5", ou o lote completo com 12 dígitos.
              </p>
              
              <div className="space-y-4 mb-6">
                <div>
                  <label className="block text-xs font-bold text-neutral-700 uppercase tracking-wider mb-1.5">
                    Código do Lote da Manta
                  </label>
                  <input
                    type="number"
                    inputMode="numeric"
                    value={manualBarcode}
                    onChange={(e) => setManualBarcode(e.target.value)}
                    placeholder="Ex: 512345678901 ou 12345678901"
                    autoFocus
                    className="w-full border border-neutral-300 rounded-lg p-3 text-lg font-mono font-semibold focus:ring-2 focus:ring-[#009988] focus:border-[#009988] outline-none"
                  />
                  <p className="text-[11px] text-neutral-400 mt-1.5">
                    Se você digitar os 11 dígitos sem o 5, o sistema insere o 5 no início automaticamente.
                  </p>
                </div>
              </div>
              
              <div className="flex gap-3 justify-end">
                <Button type="button" variant="outline" onClick={() => setActiveModal('none')} className="flex-1">
                  Cancelar
                </Button>
                <Button type="submit" className="flex-1 bg-[#009988] hover:bg-[#008877] text-white font-semibold">
                  Avançar
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}

      {/* MODAL 2: Selecionar / Digitar Katame */}
      {activeModal === 'katame' && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 backdrop-blur-sm">
          <Card className="w-full max-w-sm p-6 bg-white animate-in fade-in zoom-in duration-200 shadow-2xl">
            <form onSubmit={handleKatameSubmit}>
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-lg font-bold text-neutral-900">Etapa 1: Katame</h3>
                <span className="text-xs font-semibold px-2 py-0.5 rounded bg-[#009988]/10 text-[#009988]">Passo 1 de 2</span>
              </div>
              
              {/* Scanned Barcode badge */}
              <div className="bg-neutral-100 p-2.5 rounded-lg border border-neutral-200 mb-5">
                <span className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider block">Lote Lido</span>
                <span className="font-mono text-base font-bold text-neutral-900">{currentBarcode}</span>
              </div>
              
              <div className="space-y-4 mb-6">
                <div>
                  <label className="block text-xs font-bold text-neutral-700 uppercase tracking-wider mb-1.5">
                    Digite ou Escolha o Katame (ex: REBK)
                  </label>
                  <input
                    type="text"
                    value={katameInput}
                    onChange={(e) => setKatameInput(e.target.value.toUpperCase())}
                    placeholder="Ex: REBK, RETBK978..."
                    autoFocus
                    className="w-full border border-neutral-300 rounded-lg p-3 text-lg font-bold text-[#009988] focus:ring-2 focus:ring-[#009988] focus:border-[#009988] outline-none uppercase"
                  />
                </div>

                {/* Quick tap chips */}
                <div>
                  <label className="block text-[11px] font-semibold text-neutral-500 mb-2">
                    Toque rápido em um Katame comum:
                  </label>
                  <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto p-1 border border-neutral-100 rounded-lg bg-neutral-50">
                    {katames.map((k) => (
                      <button
                        type="button"
                        key={k}
                        onClick={() => setKatameInput(k)}
                        className={`px-2.5 py-1 text-xs rounded-md font-bold transition-all ${
                          katameInput === k
                            ? 'bg-[#009988] text-white shadow-sm'
                            : 'bg-white text-neutral-700 border border-neutral-200 hover:border-[#009988]'
                        }`}
                      >
                        {k}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              
              <div className="flex gap-3 justify-end">
                <Button type="button" variant="outline" onClick={closeModalAndResume} className="flex-1">
                  Cancelar
                </Button>
                <Button type="submit" className="flex-1 bg-[#009988] hover:bg-[#008877] text-white font-semibold">
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

        {/* When camera is OFF (power saving) */}
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

        {/* Camera error state */}
        {cameraError && isCameraActive && (
          <div className="absolute inset-0 z-10 bg-neutral-900 flex flex-col items-center justify-center p-6 text-center">
            <p className="text-white mb-4 text-sm">Câmera indisponível ou permissão negada.</p>
            <div className="flex gap-2">
              <Button variant="outline" className="bg-white/10 text-white border-white/20 hover:bg-white/20 text-xs" onClick={startScanner}>
                Tentar Novamente
              </Button>
              <Button variant="outline" className="bg-white/10 text-white border-white/20 hover:bg-white/20 text-xs" onClick={() => fileInputRef.current?.click()}>
                <Upload className="h-4 w-4 mr-1.5" />
                Galeria
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
              Auto-Scan (1º Barcode da Manta)
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
              <Card key={scan.id || idx} className="p-4 shadow-sm border-neutral-100 relative">
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
                  <p className="font-mono text-lg font-bold text-neutral-900">{scan.lote || 'Sem Lote'}</p>
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
