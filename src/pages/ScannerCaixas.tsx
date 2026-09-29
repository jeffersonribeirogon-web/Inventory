import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Trash2, Download, Mail, ScanLine, Camera, CameraOff, Loader2, Upload, Save, BarChart2 } from 'lucide-react';
import { collection, addDoc, query, orderBy, onSnapshot, deleteDoc, doc, serverTimestamp, getDocs } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import Papa from 'papaparse';
import { Html5Qrcode } from 'html5-qrcode';
import { saveInventoryReport } from '../lib/reports';

interface ScanItem {
  id: string;
  composto?: string;
  lote?: string;
  unidade?: string;
  dataExpiracao?: string;
  scannedAt?: any;
}

export function ScannerCaixas() {
  const navigate = useNavigate();
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const captureRequestedRef = useRef(false);
  const isModalOpenRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [scans, setScans] = useState<ScanItem[]>([]);
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

  // Sync modal state to ref for the scanner callback
  useEffect(() => {
    isModalOpenRef.current = activeModal !== 'none';
    if (activeModal === 'none') {
      setDuplicateError(false);
    }
  }, [activeModal]);

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
          if (isModalOpenRef.current) return; // Ignore scans while popup is open

          const cleanText = decodedText.trim();
          
          // Only accept exactly 12 numeric digits
          if (!/^\d{12}$/.test(cleanText)) return;

          // Auto-capture if barcode starts with '5'
          const isAutoMatch = cleanText.startsWith('5');

          if (isAutoMatch) {
            playBeep();
            setIsReading(false);
            
            setCurrentBarcode(cleanText);
            setActiveModal('katame');
          }
        },
        () => {
          // Ignore normal scanning errors
        }
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
    
    setCurrentBarcode(finalBarcode);
    setActiveModal('katame');
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
      
      playBeep();
      setCurrentBarcode(cleanText);
      setActiveModal('katame');
    } catch (err) {
      console.error(err);
      alert("Nenhum código de barras encontrado na imagem.");
    } finally {
      setIsReading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const saveScan = async (e: React.FormEvent) => {
    e.preventDefault();
    setDuplicateError(false);
    
    // Duplicate check
    const isDuplicate = scans.some(scan => 
      String(scan.lote || '').trim() === currentBarcode.trim() && 
      String(scan.composto || '').trim() === katameInput.trim() && 
      String(scan.unidade || '').trim() === localInput.trim()
    );
    
    if (isDuplicate) {
      setDuplicateError(true);
      alert("⚠️ DUPLICIDADE DETECTADA: Este Lote já foi registrado com este Katame e Local!");
      return;
    }

    try {
      await addDoc(collection(db, 'inventory_scans'), {
        lote: currentBarcode,
        composto: katameInput,
        unidade: localInput,
        scannedAt: serverTimestamp()
      });
      
      closeModalAndResume();
    } catch (err) {
      console.error(err);
      alert("Erro ao salvar dados.");
    }
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

  const exportCSV = () => {
    const csvData = scans.map(s => ({
      'Lote (Barcode)': s.lote || '',
      'Composto': s.composto || '',
      'Unidade': s.unidade || '',
      'Data Expiração': s.dataExpiracao || '',
      'Data/Hora (App)': s.scannedAt?.toDate() ? s.scannedAt.toDate().toLocaleString('pt-BR') : 'N/A'
    }));
    const csv = Papa.unparse(csvData);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `inventario_reuso_${new Date().toISOString()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const sendEmail = () => {
    const csvData = scans.map(s => ({
      'Lote (Barcode)': s.lote || '',
      'Composto': s.composto || '',
      'Unidade': s.unidade || '',
      'Data Expiração': s.dataExpiracao || '',
      'Data/Hora (App)': s.scannedAt?.toDate() ? s.scannedAt.toDate().toLocaleString('pt-BR') : 'N/A'
    }));
    const csv = Papa.unparse(csvData);
    const subject = encodeURIComponent("Inventário de Etiquetas de Reuso");
    const body = encodeURIComponent("Segue em anexo os dados do inventário (Cole os dados abaixo no Excel):\n\n" + csv);
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
  };

  return (
    <div className="min-h-screen bg-[#eeeeee] flex flex-col max-w-lg mx-auto shadow-xl relative">
      
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
                <Button type="button" onClick={() => setActiveModal('local')} className="flex-1 bg-[#009988] hover:bg-[#008877] text-white">
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

      {isOffline && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 flex items-center justify-center text-amber-800 text-xs font-medium z-10 relative shadow-sm">
          <span className="w-2 h-2 rounded-full bg-amber-500 mr-2 animate-pulse"></span>
          Modo Offline Ativo. Leituras serão sincronizadas quando houver internet.
        </div>
      )}

      <div className="relative bg-black aspect-[3/4] w-full overflow-hidden flex items-center justify-center">
        {/* Reader element - always kept mounted in DOM */}
        <div id="reader" className={`w-full h-full [&>video]:object-cover [&>video]:w-full [&>video]:h-full ${!isCameraActive || cameraError ? 'invisible' : ''}`} />

        {/* Standby UI when camera is turned off for power saving */}
        {!isCameraActive && (
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
            <p className="text-white mb-4">Câmera indisponível ou permissão negada.</p>
            <div className="flex gap-2">
              <Button variant="outline" className="bg-white/10 text-white border-white/20 hover:bg-white/20" onClick={() => startScanner()}>
                Tentar Novamente
              </Button>
              <Button variant="outline" className="bg-white/10 text-white border-white/20 hover:bg-white/20" onClick={() => fileInputRef.current?.click()}>
                <Upload className="h-4 w-4 mr-2" />
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
              <Card key={scan.id} className="p-4 shadow-sm border-neutral-100 relative">
                <div className="absolute top-2 right-2">
                  <Button variant="ghost" size="icon" onClick={() => deleteItem(scan.id)} className="h-6 w-6">
                    <Trash2 className="h-4 w-4 text-neutral-400 hover:text-red-500" />
                  </Button>
                </div>
                <div className="mb-2">
                  <div className="flex gap-2 mb-1">
                    <span className="inline-block bg-[#2941CC]/10 text-[#2941CC] font-bold px-2 py-1 rounded text-sm">
                      {scan.composto || 'SEM KATAME'}
                    </span>
                    <span className="inline-block bg-emerald-100 text-emerald-800 font-bold px-2 py-1 rounded text-sm">
                      {scan.unidade || 'SEM LOCAL'}
                    </span>
                  </div>
                  <p className="font-mono text-lg font-semibold text-neutral-900">{scan.lote || 'Sem Lote'}</p>
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

