import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Box, Layers, WifiOff, RefreshCw, Loader2, BarChart, 
  Smartphone, QrCode, Cloud, X, Check, Copy, FileSpreadsheet,
  Upload, Trash2, Eye, Download, Search, CheckCircle2, AlertTriangle, ArrowRight, Table
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { getQueue, removeFromQueue, QueuedImage } from '../lib/queue';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';
import QRCode from 'qrcode';
import { 
  ExcelCaixaItem, ExcelBaseMeta, getExcelBaseLocally, saveExcelBaseLocally, 
  clearExcelBaseLocally, saveExcelBaseToCloud, clearExcelBaseFromCloud, 
  listenToCloudExcelBase, parseExcelFile, downloadSampleExcelTemplate 
} from '../lib/excelBase';

export function Hub() {
  const navigate = useNavigate();
  const [offlineCount, setOfflineCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const [showQrModal, setShowQrModal] = useState(false);
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState('');
  const [copiedLink, setCopiedLink] = useState(false);

  // Excel base state & Preview
  const [excelBase, setExcelBase] = useState<ExcelCaixaItem[]>([]);
  const [excelMeta, setExcelMeta] = useState<ExcelBaseMeta | null>(null);
  const [isUploadingExcel, setIsUploadingExcel] = useState(false);
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [previewSearch, setPreviewSearch] = useState('');
  const hubFileInputRef = useRef<HTMLInputElement>(null);

  // Sync Excel base real-time across PC, Phone and Tablet
  useEffect(() => {
    const local = getExcelBaseLocally();
    if (local.items.length > 0) {
      setExcelBase(local.items);
      setExcelMeta(local.meta);
    }

    const unsubscribe = listenToCloudExcelBase((data) => {
      if (data) {
        setExcelBase(data.items);
        setExcelMeta(data.meta);
      } else {
        setExcelBase([]);
        setExcelMeta(null);
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
      setExcelMeta(meta);
      saveExcelBaseLocally(items, meta);
      await saveExcelBaseToCloud(items, meta);
      alert(`✅ Planilha importada com sucesso!\nTotal de caixas: ${items.length}\nDisponível em qualquer computador, celular ou tablet.`);
    } catch (err: any) {
      console.error(err);
      alert(`Erro ao ler planilha: ${err.message || "Verifique se o arquivo está no formato .xlsx, .xls ou .csv."}`);
    } finally {
      setIsUploadingExcel(false);
      if (hubFileInputRef.current) hubFileInputRef.current.value = '';
    }
  };

  const handleClearExcel = async () => {
    if (confirm("Deseja remover a planilha do inventário? Isso atualizará todos os computadores e celulares conectados.")) {
      setExcelBase([]);
      setExcelMeta(null);
      clearExcelBaseLocally();
      try {
        await clearExcelBaseFromCloud();
      } catch (e) {
        console.warn(e);
      }
    }
  };

  useEffect(() => {
    if (showQrModal) {
      const targetUrl = window.location.origin + '/scanner-caixas';
      QRCode.toDataURL(targetUrl, {
        width: 280,
        margin: 2,
        color: { dark: '#0f172a', light: '#ffffff' }
      })
        .then(setQrCodeDataUrl)
        .catch(console.error);
    }
  }, [showQrModal]);

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
      <div className="w-full max-w-4xl flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-bold text-neutral-900">Katame Inventory</h1>
          <p className="text-neutral-500">Hub Central de Inventário</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={() => setShowQrModal(true)}
            variant="outline"
            className="border-blue-300 text-blue-700 hover:bg-blue-50 flex items-center gap-2 shadow-xs bg-white rounded-xl"
          >
            <Smartphone className="h-4 w-4 text-blue-600" />
            <span>Abrir no Celular</span>
          </Button>
        </div>
      </div>

      {/* Sync tip card PC ⇄ Celular */}
      <div className="w-full max-w-4xl mb-6 bg-gradient-to-r from-blue-50/90 to-indigo-50/90 border border-blue-200 rounded-2xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-xs">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-white border border-blue-200 flex items-center justify-center text-[#2941CC] flex-shrink-0 shadow-xs">
            <Cloud className="h-5 w-5" />
          </div>
          <div>
            <h4 className="text-sm font-bold text-neutral-900 flex items-center gap-2">
              <span>Sincronização Nuvem PC ⇄ Celular</span>
              <span className="text-[10px] bg-emerald-100 text-emerald-800 font-bold px-2 py-0.5 rounded-full">
                Ativo
              </span>
            </h4>
            <p className="text-xs text-neutral-600 mt-0.5">
              Carregue a planilha Excel no computador e use a câmera do seu celular para bipar as caixas na área. Os dados, conferências e sobras sincronizam instantaneamente em ambas as telas!
            </p>
          </div>
        </div>
        <Button
          size="sm"
          onClick={() => setShowQrModal(true)}
          className="bg-[#2941CC] hover:bg-[#2941CC]/90 text-white text-xs font-semibold px-3 py-2 rounded-xl flex-shrink-0"
        >
          <QrCode className="h-3.5 w-3.5 mr-1.5" />
          Conectar Celular
        </Button>
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

      {/* SEÇÃO: BASE DE CONFERÊNCIA EXCEL (MULTIPLATAFORMA) */}
      <input 
        type="file" 
        accept=".xlsx, .xls, .csv, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.ms-excel, text/csv" 
        ref={hubFileInputRef} 
        onChange={handleHubExcelUpload} 
        className="hidden" 
      />

      <Card className="w-full max-w-4xl mb-6 bg-white border-neutral-200/90 shadow-sm overflow-hidden">
        <div className="p-5">
          {excelBase.length > 0 ? (
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-600 flex-shrink-0">
                    <FileSpreadsheet className="h-6 w-6" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-neutral-900 text-base">
                        {excelMeta?.fileName || 'Planilha de Caixas Ativa'}
                      </span>
                      <span className="text-xs bg-emerald-100 text-emerald-800 font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3" />
                        {excelBase.length} caixas
                      </span>
                      <span className="text-xs bg-blue-50 text-blue-700 font-semibold px-2 py-0.5 rounded-full flex items-center gap-1">
                        <Cloud className="h-3 w-3 text-blue-600" />
                        Nuvem Ativa
                      </span>
                    </div>
                    <p className="text-xs text-neutral-500 mt-1">
                      Enviado via <strong>{excelMeta?.uploadedBy || 'Plataforma'}</strong> em{' '}
                      {excelMeta ? new Date(excelMeta.uploadedAt).toLocaleString('pt-BR') : ''}. Sincronizado com todos os dispositivos.
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto justify-end">
                  <Button
                    size="sm"
                    onClick={() => navigate('/scanner-caixas')}
                    className="bg-[#2941CC] hover:bg-[#2941CC]/90 text-white font-semibold text-xs h-9 px-3.5 rounded-xl shadow-xs flex items-center gap-1.5"
                  >
                    <span>Ir para o Scanner</span>
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>

              {/* Ações Rápidas */}
              <div className="pt-3 border-t border-neutral-100 flex items-center justify-between flex-wrap gap-2 text-xs">
                <div className="flex items-center gap-2 flex-wrap">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setShowPreviewModal(true)}
                    className="h-8 text-neutral-700 border-neutral-200 hover:bg-neutral-50 flex items-center gap-1.5 rounded-lg"
                  >
                    <Table className="h-3.5 w-3.5 text-blue-600" />
                    <span>Ver Caixas da Planilha ({excelBase.length})</span>
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => hubFileInputRef.current?.click()}
                    disabled={isUploadingExcel}
                    className="h-8 text-neutral-700 border-neutral-200 hover:bg-neutral-50 flex items-center gap-1.5 rounded-lg"
                  >
                    {isUploadingExcel ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5 text-emerald-600" />}
                    <span>Trocar Planilha</span>
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={downloadSampleExcelTemplate}
                    className="h-8 text-neutral-700 border-neutral-200 hover:bg-neutral-50 flex items-center gap-1.5 rounded-lg"
                  >
                    <Download className="h-3.5 w-3.5 text-neutral-500" />
                    <span>Baixar Modelo .xlsx</span>
                  </Button>
                </div>

                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleClearExcel}
                  className="h-8 text-red-500 hover:text-red-700 hover:bg-red-50 flex items-center gap-1 rounded-lg"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span>Remover Base</span>
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="flex items-start gap-3.5">
                <div className="w-12 h-12 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-600 flex-shrink-0">
                  <FileSpreadsheet className="h-6 w-6" />
                </div>
                <div>
                  <h3 className="font-bold text-neutral-900 text-base">
                    Carregar Planilha de Caixas (Conferência de Estoque)
                  </h3>
                  <p className="text-xs text-neutral-600 mt-0.5">
                    Envie a lista com as caixas de katame que existem na área. O app cruza os 7 dígitos do lote e indica se foi encontrada ou se está fora da lista.
                  </p>
                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    <span className="text-[10px] bg-neutral-100 text-neutral-700 font-semibold px-2 py-0.5 rounded-md">💻 Computador</span>
                    <span className="text-[10px] bg-neutral-100 text-neutral-700 font-semibold px-2 py-0.5 rounded-md">📱 Celular Android & iOS</span>
                    <span className="text-[10px] bg-neutral-100 text-neutral-700 font-semibold px-2 py-0.5 rounded-md">📟 Tablet</span>
                    <span className="text-[10px] bg-emerald-50 text-emerald-700 border border-emerald-200 font-semibold px-2 py-0.5 rounded-md">.xlsx / .xls / .csv</span>
                  </div>
                </div>
              </div>

              <div className="flex sm:flex-col items-center gap-2 w-full sm:w-auto flex-shrink-0">
                <Button
                  onClick={() => hubFileInputRef.current?.click()}
                  disabled={isUploadingExcel}
                  className="w-full sm:w-auto bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs h-9 px-4 rounded-xl shadow-xs flex items-center justify-center gap-1.5"
                >
                  {isUploadingExcel ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                  <span>Carregar Planilha</span>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={downloadSampleExcelTemplate}
                  className="w-full sm:w-auto border-neutral-300 text-neutral-700 hover:bg-neutral-50 text-xs h-8 px-3 rounded-xl flex items-center justify-center gap-1.5"
                >
                  <Download className="h-3.5 w-3.5 text-neutral-500" />
                  <span>Baixar Modelo .xlsx</span>
                </Button>
              </div>
            </div>
          )}
        </div>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full max-w-4xl">
        <Card 
          className="hover:shadow-md transition-shadow cursor-pointer border-[#2941CC]/20 hover:border-[#2941CC]/50 bg-white"
          onClick={() => navigate('/scanner-caixas')}
        >
          <CardHeader>
            <div className="flex items-center justify-between mb-4">
              <div className="h-12 w-12 rounded-lg bg-[#2941CC]/10 flex items-center justify-center">
                <Box className="h-6 w-6 text-[#2941CC]" />
              </div>
              {excelBase.length > 0 && (
                <span className="text-[11px] bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded-full font-bold flex items-center gap-1">
                  <FileSpreadsheet className="h-3 w-3" />
                  Base: {excelBase.length}
                </span>
              )}
            </div>
            <CardTitle>Scanner Etiquetas (Reuso)</CardTitle>
            <CardDescription>
              Captura e extração de Lote, Composto, Unidade e Validade de etiquetas de reuso. Salva no banco de dados.
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

      {/* MODAL: ABRIR NO CELULAR COM QR CODE */}
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

              <div className="bg-blue-50/70 border border-blue-200/80 rounded-xl p-3 text-xs text-blue-900 space-y-1.5">
                <p className="font-bold flex items-center gap-1 text-blue-800">
                  <Cloud className="h-3.5 w-3.5 text-blue-600" />
                  Passo a passo:
                </p>
                <ol className="list-decimal list-inside space-y-1 text-blue-700">
                  <li>Carregue a planilha no computador no <strong>Scanner Caixas</strong>.</li>
                  <li>Escaneie este QR Code no celular para abrir o leitor.</li>
                  <li>Todas as caixas da base Excel já estarão sincronizadas no celular!</li>
                </ol>
              </div>

              <div className="flex items-center gap-2 p-2 bg-neutral-100 rounded-xl text-xs">
                <span className="truncate flex-1 font-mono text-neutral-700 px-1">
                  {typeof window !== 'undefined' ? `${window.location.origin}/scanner-caixas` : ''}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    if (navigator.clipboard) {
                      navigator.clipboard.writeText(`${window.location.origin}/scanner-caixas`);
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

      {/* MODAL: PRÉ-VISUALIZAÇÃO DAS CAIXAS DA BASE EXCEL */}
      {showPreviewModal && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in duration-200">
          <Card className="w-full max-w-2xl max-h-[85vh] flex flex-col p-5 bg-white shadow-2xl rounded-2xl animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between pb-3 border-b border-neutral-200 mb-3">
              <div>
                <h3 className="text-base font-bold text-neutral-900 flex items-center gap-2">
                  <FileSpreadsheet className="h-5 w-5 text-emerald-600" />
                  <span>Caixas da Base Excel ({excelBase.length})</span>
                </h3>
                <p className="text-xs text-neutral-500">
                  {excelMeta?.fileName || 'Planilha'} • {excelMeta?.uploadedBy || 'Nuvem'}
                </p>
              </div>
              <Button variant="ghost" size="icon" onClick={() => setShowPreviewModal(false)} className="h-8 w-8">
                <X className="h-4 w-4" />
              </Button>
            </div>

            {/* Search */}
            <div className="mb-3 relative">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-neutral-400" />
              <input
                type="text"
                placeholder="Buscar por lote (ex: 1013061) ou composto..."
                value={previewSearch}
                onChange={(e) => setPreviewSearch(e.target.value)}
                className="w-full pl-9 pr-4 py-2 border border-neutral-300 rounded-xl text-xs focus:outline-hidden focus:ring-2 focus:ring-[#2941CC]"
              />
            </div>

            {/* List / Table */}
            <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
              {excelBase
                .filter(item => {
                  if (!previewSearch.trim()) return true;
                  const term = previewSearch.trim().toUpperCase();
                  return item.lote.includes(term) || item.composto.toUpperCase().includes(term);
                })
                .slice(0, 150)
                .map((item, idx) => (
                  <div key={idx} className="flex items-center justify-between p-2.5 bg-neutral-50 border border-neutral-200/80 rounded-xl text-xs hover:bg-neutral-100/70 transition-colors">
                    <div className="flex items-center gap-2.5">
                      <span className="font-mono text-neutral-400 text-[10px] w-6 text-right">{idx + 1}.</span>
                      <span className="bg-[#2941CC]/10 text-[#2941CC] font-bold px-2 py-0.5 rounded text-[11px]">
                        {item.composto}
                      </span>
                      <span className="font-mono font-bold text-neutral-900 text-sm">
                        {item.lote}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-neutral-600 font-mono text-[11px]">
                      {item.peso && <span>P. Teor: <strong>{item.peso} kg</strong></span>}
                      {item.pesoReal && <span className="text-emerald-700 font-bold">P. Real: {item.pesoReal} kg</span>}
                    </div>
                  </div>
                ))}

              {excelBase.length > 150 && !previewSearch && (
                <p className="text-center text-[11px] text-neutral-400 py-2">
                  Mostrando primeiras 150 de {excelBase.length} caixas. Use a busca acima para encontrar um lote específico.
                </p>
              )}
            </div>

            <div className="pt-3 border-t border-neutral-200 mt-3 flex items-center justify-between gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={downloadSampleExcelTemplate}
                className="text-xs text-neutral-600"
              >
                <Download className="h-3.5 w-3.5 mr-1 text-neutral-500" />
                Baixar Modelo .xlsx
              </Button>
              <Button
                onClick={() => {
                  setShowPreviewModal(false);
                  navigate('/scanner-caixas');
                }}
                className="bg-[#2941CC] hover:bg-[#2941CC]/90 text-white text-xs font-semibold px-4 py-2 rounded-xl"
              >
                Ir para o Scanner
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
