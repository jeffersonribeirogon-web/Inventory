import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Camera, ArrowLeft, Trash2, Download, Mail, Loader2 } from 'lucide-react';
import { collection, addDoc, query, orderBy, onSnapshot, deleteDoc, doc, serverTimestamp, getDocs } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { addToQueue } from '../lib/queue';
import Papa from 'papaparse';

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
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [scans, setScans] = useState<ScanItem[]>([]);

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

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' }
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        setIsCameraActive(true);
      }
    } catch (err) {
      console.error("Error accessing camera:", err);
      alert("Não foi possível acessar a câmera. Verifique as permissões.");
    }
  };

  const stopCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
      videoRef.current.srcObject = null;
      setIsCameraActive(false);
    }
  };

  useEffect(() => {
    startCamera();
    return () => stopCamera();
  }, []);

  const captureAndProcess = async () => {
    if (!videoRef.current || !canvasRef.current) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    
    // Scale down image to avoid Vercel 4.5MB payload limit
    const MAX_DIMENSION = 1280;
    let width = video.videoWidth;
    let height = video.videoHeight;
    
    if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
      const ratio = Math.min(MAX_DIMENSION / width, MAX_DIMENSION / height);
      width = Math.round(width * ratio);
      height = Math.round(height * ratio);
    }
    
    canvas.width = width;
    canvas.height = height;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    // Draw current video frame to canvas
    ctx.drawImage(video, 0, 0, width, height);
    
    // Get compressed Base64 image
    const imageBase64 = canvas.toDataURL('image/jpeg', 0.7);
    
    setIsProcessing(true);
    
    try {
      if (!navigator.onLine) {
        throw new Error('OFFLINE');
      }

      const res = await fetch('/api/process-caixa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64 })
      });
      
      const data = await res.json();
      
      if (data.data) {
        // Save to Firestore
        await addDoc(collection(db, 'inventory_scans'), {
          ...data.data,
          scannedAt: serverTimestamp()
        });
      } else {
        alert("Não foi possível identificar as informações na etiqueta.");
      }
    } catch (err: any) {
      if (err.message === 'OFFLINE' || err.message.includes('fetch')) {
        await addToQueue('caixa', imageBase64);
        alert('Sem conexão! A imagem foi salva localmente e será processada quando a internet retornar.');
      } else {
        console.error(err);
        alert("Erro ao processar imagem.");
      }
    } finally {
      setIsProcessing(false);
    }
  };

  const deleteItem = async (id: string) => {
    if (confirm('Remover este item?')) {
      await deleteDoc(doc(db, 'inventory_scans', id));
    }
  };

  const clearAll = async () => {
    if (confirm('Tem certeza que deseja apagar todos os registros do banco?')) {
      const q = query(collection(db, 'inventory_scans'));
      const querySnapshot = await getDocs(q);
      const deletePromises = querySnapshot.docs.map((docSnapshot) => 
        deleteDoc(doc(db, 'inventory_scans', docSnapshot.id))
      );
      await Promise.all(deletePromises);
    }
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
      {isProcessing && (
        <div className="absolute inset-0 z-50 bg-black/60 flex flex-col items-center justify-center text-white backdrop-blur-sm">
          <Loader2 className="h-12 w-12 animate-spin text-[#009988] mb-4" />
          <p className="font-semibold text-lg">Processando imagem com Gemini...</p>
          <p className="text-sm text-neutral-300">Extraindo dados da etiqueta</p>
        </div>
      )}
      
      <header className="bg-white p-4 flex items-center justify-between border-b border-neutral-200">
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
        {!isCameraActive && !isProcessing && (
          <p className="text-white">Iniciando câmera...</p>
        )}
        <video 
          ref={videoRef} 
          autoPlay 
          playsInline 
          className="object-cover w-full h-full"
        />
        <canvas ref={canvasRef} className="hidden" />
        
        <div className="absolute bottom-6 left-0 right-0 flex justify-center">
          <button 
            onClick={captureAndProcess}
            disabled={!isCameraActive || isProcessing}
            className="h-16 w-16 rounded-full bg-white/20 border-4 border-white flex items-center justify-center active:scale-95 transition-transform"
          >
            <Camera className="h-6 w-6 text-white" />
          </button>
        </div>
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
                  <span className="inline-block bg-[#2941CC]/10 text-[#2941CC] font-bold px-2 py-1 rounded text-sm mb-1">{scan.composto || 'S/ COMPOSTO'}</span>
                  <p className="font-mono text-lg font-semibold text-neutral-900">{scan.lote || 'Sem Lote'}</p>
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div><span className="text-neutral-500 block text-xs">Unidade</span> {scan.unidade || '-'}</div>
                  <div><span className="text-neutral-500 block text-xs">Validade</span> {scan.dataExpiracao || '-'}</div>
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
