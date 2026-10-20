import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Box, Layers, WifiOff, RefreshCw, Loader2, BarChart, FileSpreadsheet, Upload, Cloud
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { getQueue, removeFromQueue } from '../lib/queue';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { 
  ExcelCaixaItem, getExcelBaseLocally, listenToCloudExcelBase, 
  parseExcelFile, saveExcelBaseLocally, saveExcelBaseToCloud 
} from '../lib/excelBase';

export function Hub() {
  const navigate = useNavigate();
  const [offlineCount, setOfflineCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isUploadingExcel, setIsUploadingExcel] = useState(false);
  const hubFileInputRef = useRef<HTMLInputElement>(null);

  // Excel base state (for indicator badge on scanner card)
  const [excelBase, setExcelBase] = useState<ExcelCaixaItem[]>([]);

  // Sync Excel base real-time across PC, Phone and Tablet
  useEffect(() => {
    const local = getExcelBaseLocally();
    if (local.items.length > 0) {
      setExcelBase(local.items);
    }

    const unsubscribe = listenToCloudExcelBase((data) => {
      if (data) {
        setExcelBase(data.items);
      } else {
        setExcelBase([]);
      }
    });

    return () => unsubscribe();
  }, []);

  const handleHubExcelUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploadingExcel(true);
    try {
      const { items, meta } = await parseExcelFile(file);
      setExcelBase(items);
      saveExcelBaseLocally(items, meta);
      await saveExcelBaseToCloud(items, meta);
      alert(`✅ Planilha sincronizada na rede com sucesso!\nTotal de caixas: ${items.length}\nAgora qualquer computador, celular ou tablet fará o cruzamento ao vivo.`);
    } catch (err: any) {
      console.error(err);
      alert(`Erro ao ler arquivo: ${err.message || "Verifique se o arquivo está no formato .xlsx, .xls ou .csv."}`);
    } finally {
      setIsUploadingExcel(false);
      if (hubFileInputRef.current) hubFileInputRef.current.value = '';
    }
  };

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
          if (data.data) {
            await addDoc(collection(db, 'inventory_scans'), {
              ...data.data,
              scannedAt: serverTimestamp()
            });
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


      <input 
        type="file" 
        accept=".xlsx, .xls, .csv" 
        ref={hubFileInputRef} 
        onChange={handleHubExcelUpload} 
        className="hidden" 
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full max-w-4xl">
        <Card 
          className="hover:shadow-md transition-shadow cursor-pointer border-[#2941CC]/20 hover:border-[#2941CC]/50 bg-white flex flex-col justify-between"
          onClick={() => navigate('/scanner-caixas')}
        >
          <CardHeader>
            <div className="flex items-center justify-between mb-4">
              <div className="h-12 w-12 rounded-lg bg-[#2941CC]/10 flex items-center justify-center">
                <Box className="h-6 w-6 text-[#2941CC]" />
              </div>
              {excelBase.length > 0 ? (
                <span className="text-[11px] bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded-full font-bold flex items-center gap-1">
                  <Cloud className="h-3 w-3 text-emerald-600" />
                  Base na Rede: {excelBase.length}
                </span>
              ) : (
                <span className="text-[10px] bg-neutral-100 text-neutral-600 border border-neutral-200 px-2 py-0.5 rounded-full font-medium flex items-center gap-1">
                  <FileSpreadsheet className="h-3 w-3 text-neutral-500" />
                  Cruzar c/ Excel
                </span>
              )}
            </div>
            <CardTitle>Scanner Etiquetas (Reuso)</CardTitle>
            <CardDescription>
              Leitura com cruzamento automático vs lista base Excel na nuvem. Sincronizado em tempo real no PC e Celular.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 pt-0">
            <Button className="w-full bg-[#2941CC] hover:bg-[#2941CC]/90 text-white font-medium">
              Acessar Scanner
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isUploadingExcel}
              onClick={(e) => {
                e.stopPropagation();
                hubFileInputRef.current?.click();
              }}
              className="w-full text-xs font-semibold text-neutral-700 hover:text-emerald-700 hover:bg-emerald-50 border-neutral-200 flex items-center justify-center gap-1.5 h-8"
            >
              {isUploadingExcel ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-600" />
              ) : (
                <Upload className="h-3.5 w-3.5 text-emerald-600" />
              )}
              <span>{excelBase.length > 0 ? "Trocar Planilha na Nuvem" : "Carregar Planilha Base"}</span>
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

        <Card 
          className="hover:shadow-md transition-shadow cursor-pointer border-[#f59e0b]/20 hover:border-[#f59e0b]/50 bg-white"
          onClick={() => navigate('/relatorio-caixas')}
        >
          <CardHeader>
            <div className="h-12 w-12 rounded-lg bg-[#f59e0b]/10 flex items-center justify-center mb-4">
              <BarChart className="h-6 w-6 text-[#f59e0b]" />
            </div>
            <CardTitle>Relatório Caixas</CardTitle>
            <CardDescription>
              Dashboard analítico com histórico e indicadores de leituras de inventário das caixas e katames.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button className="w-full bg-[#f59e0b] hover:bg-[#f59e0b]/90 text-white">
              Ver Relatórios
            </Button>
          </CardContent>
        </Card>
      </div>




    </div>
  );
}
