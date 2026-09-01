import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Layers, WifiOff, RefreshCw, Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { getQueue, removeFromQueue, QueuedImage } from '../lib/queue';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';

export function Hub() {
  const navigate = useNavigate();
  const [offlineCount, setOfflineCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);

  useEffect(() => {
    const checkQueue = async () => {
      const items = await getQueue();
      setOfflineCount(items.length);
    };
    checkQueue();
    // Check periodically
    const interval = setInterval(checkQueue, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleSync = async () => {
    if (!navigator.onLine) {
      alert("Você ainda parece estar offline.");
      return;
    }
    
    setIsSyncing(true);
    try {
      const items = await getQueue();
      for (const item of items) {
        if (item.type === 'caixa') {
          const res = await fetch('/api/process-caixa', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ imageBase64: item.imageBase64 })
          });
          const data = await res.json();
          if (data.barcodes && Array.isArray(data.barcodes)) {
            for (const barcode of data.barcodes) {
              await addDoc(collection(db, 'inventory_scans'), {
                barcode,
                scannedAt: serverTimestamp()
              });
            }
          }
        } else if (item.type === 'manta') {
          const res = await fetch('/api/process-manta', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ imageBase64: item.imageBase64 })
          });
          const resData = await res.json();
          if (resData.data) {
            const newScan = {
              id: crypto.randomUUID(),
              ...resData.data,
              timestamp: Date.now()
            };
            const existingMantas = JSON.parse(localStorage.getItem('katame_mantas_scans') || '[]');
            localStorage.setItem('katame_mantas_scans', JSON.stringify([newScan, ...existingMantas]));
          }
        }
        await removeFromQueue(item.id);
      }
      setOfflineCount(0);
      alert("Sincronização concluída com sucesso!");
    } catch (err) {
      console.error(err);
      alert("Erro durante a sincronização. Verifique a conexão.");
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#eeeeee] flex flex-col items-center py-12 px-4 sm:px-6">
      <div className="w-full max-w-4xl flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold text-neutral-900">Katame Inventory</h1>
          <p className="text-neutral-500">Hub Central de Inventário</p>
        </div>
      </div>

      {offlineCount > 0 && (
        <Card className="w-full max-w-4xl mb-6 border-orange-200 bg-orange-50">
          <CardContent className="p-4 flex items-center justify-between">
            <div className="flex items-center text-orange-800">
              <WifiOff className="h-5 w-5 mr-3" />
              <div>
                <p className="font-semibold">Modo Offline Ativo</p>
                <p className="text-sm">Você tem {offlineCount} imagem(ns) na fila aguardando conexão.</p>
              </div>
            </div>
            <Button onClick={handleSync} disabled={isSyncing} className="bg-orange-600 hover:bg-orange-700 text-white">
              {isSyncing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
              Sincronizar
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full max-w-4xl">
        <Card 
          className="hover:shadow-md transition-shadow cursor-pointer border-[#2941CC]/20 hover:border-[#2941CC]/50 bg-white"
          onClick={() => navigate('/scanner-caixas')}
        >
          <CardHeader>
            <div className="h-12 w-12 rounded-lg bg-[#2941CC]/10 flex items-center justify-center mb-4">
              <Box className="h-6 w-6 text-[#2941CC]" />
            </div>
            <CardTitle>Scanner de Caixas</CardTitle>
            <CardDescription>
              Captura e extração de códigos de barras de caixas. Salva no banco de dados centralizado em tempo real.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button className="w-full bg-[#2941CC] hover:bg-[#2941CC]/90 text-white">
              Acessar Scanner
            </Button>
          </CardContent>
        </Card>

        <Card 
          className="hover:shadow-md transition-shadow cursor-pointer border-[#009988]/20 hover:border-[#009988]/50 bg-white"
          onClick={() => navigate('/scanner-mantas')}
        >
          <CardHeader>
            <div className="h-12 w-12 rounded-lg bg-[#009988]/10 flex items-center justify-center mb-4">
              <Layers className="h-6 w-6 text-[#009988]" />
            </div>
            <CardTitle>Scanner de Mantas</CardTitle>
            <CardDescription>
              Captura de etiquetas de produção. Extração de OP, Produto, Medida, Pesos e Data. Exportação local.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button className="w-full bg-[#009988] hover:bg-[#009988]/90 text-white">
              Acessar Scanner
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
