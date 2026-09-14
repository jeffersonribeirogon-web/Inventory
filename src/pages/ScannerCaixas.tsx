import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Trash2, Download, Mail, ScanLine, Camera, Loader2, Upload } from 'lucide-react';
import { collection, addDoc, query, orderBy, onSnapshot, deleteDoc, doc, serverTimestamp, getDocs } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import Papa from 'papaparse';
import { Html5Qrcode } from 'html5-qrcode';

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
  
  // Modal states
  const [activeModal, setActiveModal] = useState<'none' | 'katame' | 'local'>('none');
  const [currentBarcode, setCurrentBarcode] = useState('');
  const [katameInput, setKatameInput] = useState('REBK');
  const [localInput, setLocalInput] = useState('UNIT1');

  const [duplicateError, setDuplicateError] = useState(false);

  // Sync modal state to ref for the scanner callback
  useEffect(() => {
    isModalOpenRef.current = activeModal !== 'none';
    if (activeModal === 'none') {
      setDuplicateError(false);
    }
  }, [activeModal]);

  const katames = ["REBK", "RETBK978", "RET", "RESW", "REL", "REP", "RETBSW", "RETB2", "RETB3", "RETB4", "RETBA", "RETK", "REK367"];
  const locais = ["UNIT1", "UNIT2", "UNIT3", "UNIT4", "UNIT5", "UNIT6", "TBR1", "TBR2", "MIX"];

  // Setup Firestore Real-time listener
  useEffect(() => {
    const q = query(collection(db, 'inventory_scans'), orderBy('scannedAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const items: ScanItem[] = [];
      snapshot.forEach((doc) => {
        items.push({ id: doc.id, ...doc.data() } as ScanItem);
      });
      setScans(items);
    });
    return () => unsubscribe();
  }, []);

  // Initialize Barcode Scanner
  useEffect(() => {
    const scanner = new Html5Qrcode("reader");
    scannerRef.current = scanner;

    const startScanner = async () => {
      try {
        await scanner.start(
          { facingMode: "environment" },
          { 
            fps: 15, 
            qrbox: { width: 320, height: 160 } 
          },
          (decodedText) => {
            if (isModalOpenRef.current) return; // Ignore scans while popup is open

            const cleanText = decodedText.trim();
            if (cleanText.length < 12) return; // Enforce minimum 12 characters

            // Auto-capture if barcode starts with '5', otherwise require manual trigger
            const isAutoMatch = cleanText.startsWith('5');
            const isManualRequest = captureRequestedRef.current;

            if (isAutoMatch || isManualRequest) {
              captureRequestedRef.current = false; // Reset manual trigger if used
              setIsReading(false);
              
              setCurrentBarcode(cleanText);
              setActiveModal('katame');
            }
          },
          (error) => {
            // Ignore normal scanning errors
          }
        );
      } catch (err) {
        console.error("Camera access error:", err);
        setCameraError(true);
      }
    };

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

  const handleManualScan = () => {
    if (!scannerRef.current || scannerRef.current.getState() !== 2) return;
    
    // Toggle manual read mode
    captureRequestedRef.current = !captureRequestedRef.current;
    setIsReading(captureRequestedRef.current);
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !scannerRef.current) return;
    
    try {
      setIsReading(true);
      const decodedText = await scannerRef.current.scanFile(file, true);
      const cleanText = decodedText.trim();
      
      if (cleanText.length < 12) {
        alert("O código de barras da imagem é muito curto (mínimo de 12 caracteres).");
        return;
      }
      
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
    setKatameInput('REBK');
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
        <div className="absolute inset-0 z-50 bg-black/60 flex items-center justify-center p-4 backdrop-blur-sm">
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
        <div className="absolute inset-0 z-50 bg-black/60 flex items-center justify-center p-4 backdrop-blur-sm">
          <Card className="w-full max-w-sm p-6 animate-in fade-in zoom-in duration-200">
            <h3 className="text-xl font-bold text-neutral-900 mb-2">Apagar tudo?</h3>
            <p className="text-neutral-500 mb-6">Você tem certeza que deseja remover todos os registros do banco de dados? Esta ação não pode ser desfeita.</p>
            <div className="flex gap-3 justify-end">
              <Button variant="outline" onClick={() => setShowClearConfirm(false)} className="flex-1">Cancelar</Button>
              <Button onClick={confirmClearAll} className="flex-1 bg-red-500 hover:bg-red-600 text-white">Apagar Tudo</Button>
            </div>
          </Card>
        </div>
      )}

      {activeModal === 'katame' && (
        <div className="absolute inset-0 z-50 bg-black/80 flex items-center justify-center p-4 backdrop-blur-sm">
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
        <div className="absolute inset-0 z-50 bg-black/80 flex items-center justify-center p-4 backdrop-blur-sm">
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
        <div className="flex gap-2">
          <Button variant="ghost" size="icon" onClick={exportCSV} title="Exportar CSV">
            <Download className="h-5 w-5 text-[#2941CC]" />
          </Button>
          <Button variant="ghost" size="icon" onClick={sendEmail} title="Enviar por Email">
            <Mail className="h-5 w-5 text-[#2941CC]" />
          </Button>
        </div>
      </header>

      <div className="relative bg-black aspect-[3/4] w-full overflow-hidden flex items-center justify-center">
        {cameraError && (
          <div className="absolute inset-0 z-10 bg-neutral-900 flex flex-col items-center justify-center p-6 text-center">
            <p className="text-white mb-4">Câmera indisponível ou permissão negada.</p>
            <Button variant="outline" className="bg-white/10 text-white border-white/20 hover:bg-white/20" onClick={() => fileInputRef.current?.click()}>
              <Upload className="h-5 w-5 mr-2" />
              Enviar Foto da Galeria
            </Button>
          </div>
        )}
        
        <div id="reader" className="w-full h-full [&>video]:object-cover [&>video]:w-full [&>video]:h-full" />
        
        <input 
          type="file" 
          accept="image/*" 
          capture="environment"
          ref={fileInputRef} 
          onChange={handleFileUpload} 
          className="hidden" 
        />
        
        {/* Overlay instructions */}
        <div className="absolute inset-x-0 top-6 flex justify-center pointer-events-none z-10">
          <div className="bg-black/50 text-white px-4 py-2 rounded-full backdrop-blur-md text-sm font-medium flex items-center shadow-lg border border-white/10">
            <ScanLine className="h-4 w-4 mr-2" />
            {isReading ? 'Modo Manual (Aguardando)' : 'Auto-Scan (Lotes iniciando em 5)'}
          </div>
        </div>

        {/* Capture Button */}
        {!cameraError && (
          <div className="absolute bottom-6 left-0 right-0 flex justify-center gap-4 z-10">
            <button 
              onClick={handleManualScan}
              className={`px-6 h-14 rounded-full flex items-center justify-center transition-transform shadow-xl font-semibold text-sm ${!isReading ? 'bg-white/20 border-2 border-white text-white active:scale-95' : 'bg-red-500 border-2 border-red-500 text-white animate-pulse'}`}
            >
              {isReading ? 'Cancelar Manual' : 'Forçar Leitura Manual'}
            </button>
            <button 
              onClick={() => fileInputRef.current?.click()}
              disabled={isReading}
              className="h-14 w-14 rounded-full bg-white/10 border-2 border-white/50 flex items-center justify-center active:scale-95 transition-transform"
              title="Enviar foto da galeria"
            >
              <Upload className="h-5 w-5 text-white" />
            </button>
          </div>
        )}
      </div>

      <div className="flex-1 bg-white p-4 overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-medium text-neutral-900">Etiquetas Lidas ({scans.length})</h3>
          {scans.length > 0 && (
            <Button variant="ghost" size="sm" onClick={clearAll} className="text-red-500 hover:text-red-600 hover:bg-red-50">
              Limpar Tudo
            </Button>
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

