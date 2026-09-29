import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  ArrowLeft, BarChart2, PieChart, Activity, Box, Download, 
  Save, History, Trash2, Eye, Calendar, Clock, CheckCircle2, 
  Search, AlertCircle, Sparkles, FolderArchive, TrendingUp,
  BarChart3, Award, FileSpreadsheet, Layers
} from 'lucide-react';
import { collection, query, orderBy, onSnapshot, deleteDoc, doc, getDocs } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer,
  PieChart as RePieChart, Pie, Cell, Legend, AreaChart, Area
} from 'recharts';
import Papa from 'papaparse';
import { saveInventoryReport, SavedReport, ScanItemData } from '../lib/reports';

const COLORS = ['#2941CC', '#009988', '#f59e0b', '#ec4899', '#8b5cf6', '#10b981', '#f43f5e', '#6366f1', '#14b8a6', '#f97316'];

export function RelatorioCaixas() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'active' | 'history' | 'summary'>('active');

  // Real-time active scans from inventory_scans
  const [activeScans, setActiveScans] = useState<ScanItemData[]>([]);
  const [loadingActive, setLoadingActive] = useState(true);

  // Saved reports from inventory_reports
  const [savedReports, setSavedReports] = useState<SavedReport[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [selectedReport, setSelectedReport] = useState<SavedReport | null>(null);

  // Modals & User actions
  const [isSaving, setIsSaving] = useState(false);
  const [saveTitle, setSaveTitle] = useState('');
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [showSaveSuccessModal, setShowSaveSuccessModal] = useState(false);
  const [reportToDelete, setReportToDelete] = useState<SavedReport | null>(null);

  // Filter / Search states
  const [searchTerm, setSearchTerm] = useState('');

  // 1. Listen to active scans
  useEffect(() => {
    const q = query(collection(db, 'inventory_scans'), orderBy('scannedAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const items: ScanItemData[] = [];
      snapshot.forEach((docSnap) => {
        items.push({ id: docSnap.id, ...docSnap.data() } as ScanItemData);
      });
      setActiveScans(items);
      setLoadingActive(false);
    });
    return () => unsubscribe();
  }, []);

  // 2. Listen to historical saved reports
  useEffect(() => {
    const q = query(collection(db, 'inventory_reports'), orderBy('savedAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const reports: SavedReport[] = [];
      snapshot.forEach((docSnap) => {
        reports.push({ id: docSnap.id, ...docSnap.data() } as SavedReport);
      });
      setSavedReports(reports);
      setLoadingHistory(false);
    });
    return () => unsubscribe();
  }, []);

  // Compute analytics data for ACTIVE scans
  const activeAnalytics = useMemo(() => {
    const katameMap: Record<string, number> = {};
    const localMap: Record<string, number> = {};

    activeScans.forEach(scan => {
      const k = scan.composto || 'Desconhecido';
      katameMap[k] = (katameMap[k] || 0) + 1;
      
      const l = scan.unidade || 'Desconhecido';
      localMap[l] = (localMap[l] || 0) + 1;
    });

    const byKatame = Object.keys(katameMap)
      .map(name => ({ name, count: katameMap[name] }))
      .sort((a, b) => b.count - a.count);

    const byLocal = Object.keys(localMap)
      .map(name => ({ name, count: localMap[name] }))
      .sort((a, b) => b.count - a.count);

    return {
      totalItems: activeScans.length,
      byKatame,
      byLocal
    };
  }, [activeScans]);

  // Compute CONSOLIDATED analytics across ALL historical inventories
  const consolidatedAnalytics = useMemo(() => {
    let totalBoxesAll = 0;
    const katameTotalMap: Record<string, number> = {};
    const localTotalMap: Record<string, number> = {};
    
    // Sort reports chronologically (oldest to newest) for timeline charts
    const chronologicalReports = [...savedReports].reverse();
    const timelineData: { date: string; title: string; count: number }[] = [];

    chronologicalReports.forEach(report => {
      const count = report.totalItems || 0;
      totalBoxesAll += count;

      timelineData.push({
        date: report.dateFormatted || 'N/A',
        title: report.title || 'Inventário',
        count
      });

      // Sum up katames
      if (report.byKatame && Array.isArray(report.byKatame)) {
        report.byKatame.forEach(k => {
          katameTotalMap[k.name] = (katameTotalMap[k.name] || 0) + k.count;
        });
      } else if (report.items && Array.isArray(report.items)) {
        report.items.forEach(it => {
          const name = it.composto || 'Desconhecido';
          katameTotalMap[name] = (katameTotalMap[name] || 0) + 1;
        });
      }

      // Sum up locais
      if (report.byLocal && Array.isArray(report.byLocal)) {
        report.byLocal.forEach(l => {
          localTotalMap[l.name] = (localTotalMap[l.name] || 0) + l.count;
        });
      } else if (report.items && Array.isArray(report.items)) {
        report.items.forEach(it => {
          const name = it.unidade || 'Desconhecido';
          localTotalMap[name] = (localTotalMap[name] || 0) + 1;
        });
      }
    });

    const byKatameConsolidated = Object.keys(katameTotalMap)
      .map(name => ({
        name,
        count: katameTotalMap[name],
        percentage: totalBoxesAll > 0 ? ((katameTotalMap[name] / totalBoxesAll) * 100).toFixed(1) : '0'
      }))
      .sort((a, b) => b.count - a.count);

    const byLocalConsolidated = Object.keys(localTotalMap)
      .map(name => ({
        name,
        count: localTotalMap[name],
        percentage: totalBoxesAll > 0 ? ((localTotalMap[name] / totalBoxesAll) * 100).toFixed(1) : '0'
      }))
      .sort((a, b) => b.count - a.count);

    const avgBoxesPerInventory = savedReports.length > 0 
      ? Math.round(totalBoxesAll / savedReports.length) 
      : 0;

    return {
      totalInventories: savedReports.length,
      totalBoxes: totalBoxesAll,
      avgBoxesPerInventory,
      uniqueKatamesCount: byKatameConsolidated.length,
      uniqueLocaisCount: byLocalConsolidated.length,
      byKatame: byKatameConsolidated,
      byLocal: byLocalConsolidated,
      timelineData,
      topKatame: byKatameConsolidated[0] || null,
      topLocal: byLocalConsolidated[0] || null
    };
  }, [savedReports]);

  // Export CSV for active scans
  const exportActiveCSV = () => {
    const csvData = activeScans.map(s => ({
      'Lote (Barcode)': s.lote || '',
      'Composto (Katame)': s.composto || '',
      'Local (Unidade)': s.unidade || '',
      'Data/Hora': s.scannedAt?.toDate ? s.scannedAt.toDate().toLocaleString('pt-BR') : 'N/A'
    }));
    const csv = Papa.unparse(csvData);
    downloadCSV(csv, `inventario_ativo_${new Date().toISOString().slice(0, 10)}.csv`);
  };

  // Export CSV for a single saved report
  const exportSavedReportCSV = (report: SavedReport) => {
    const csvData = (report.items || []).map(s => ({
      'Lote (Barcode)': s.lote || '',
      'Composto (Katame)': s.composto || '',
      'Local (Unidade)': s.unidade || '',
      'Data/Hora': s.scannedAt || ''
    }));
    const csv = Papa.unparse(csvData);
    downloadCSV(csv, `relatorio_${report.dateFormatted.replace(/\//g, '-')}_${report.timeFormatted?.replace(/:/g, '') || ''}.csv`);
  };

  // Export CONSOLIDATED CSV for ALL historical inventories
  const exportAllConsolidatedCSV = () => {
    if (savedReports.length === 0) return;
    const allRows: any[] = [];
    savedReports.forEach(report => {
      (report.items || []).forEach(item => {
        allRows.push({
          'Inventário (Título)': report.title,
          'Data Inventário': report.dateFormatted,
          'Hora Inventário': report.timeFormatted || '',
          'Lote (Barcode)': item.lote,
          'Composto (Katame)': item.composto,
          'Local (Unidade)': item.unidade,
          'Hora da Leitura': item.scannedAt
        });
      });
    });
    const csv = Papa.unparse(allRows);
    downloadCSV(csv, `inventario_consolidado_geral_${new Date().toISOString().slice(0, 10)}.csv`);
  };

  const downloadCSV = (csvContent: string, fileName: string) => {
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', fileName);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Open save modal
  const handleOpenSaveModal = () => {
    if (activeScans.length === 0) {
      alert("Não há leituras ativas para salvar no relatório.");
      return;
    }
    const now = new Date();
    const dStr = now.toLocaleDateString('pt-BR');
    const tStr = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    setSaveTitle(`Inventário Caixas - ${dStr} ${tStr}`);
    setShowSaveModal(true);
  };

  // Confirm save report
  const handleConfirmSave = async () => {
    if (activeScans.length === 0) return;
    try {
      setIsSaving(true);
      await saveInventoryReport(activeScans, saveTitle.trim() || undefined);
      setShowSaveModal(false);
      setShowSaveSuccessModal(true);
    } catch (err) {
      console.error(err);
      alert("Erro ao salvar relatório no histórico.");
    } finally {
      setIsSaving(false);
    }
  };

  // Clear active scanner after saving
  const handleClearActiveScans = async () => {
    try {
      const q = query(collection(db, 'inventory_scans'));
      const querySnapshot = await getDocs(q);
      const deletePromises = querySnapshot.docs.map((docSnap) => 
        deleteDoc(doc(db, 'inventory_scans', docSnap.id))
      );
      await Promise.all(deletePromises);
      setShowSaveSuccessModal(false);
      setActiveTab('history');
    } catch (err) {
      console.error(err);
      alert("Erro ao limpar leituras.");
    }
  };

  // Delete a saved report from history
  const confirmDeleteReport = async () => {
    if (!reportToDelete) return;
    try {
      await deleteDoc(doc(db, 'inventory_reports', reportToDelete.id));
      if (selectedReport?.id === reportToDelete.id) {
        setSelectedReport(null);
      }
      setReportToDelete(null);
    } catch (err) {
      console.error(err);
      alert("Erro ao excluir relatório.");
    }
  };

  // Filtered items for display
  const filteredActiveItems = useMemo(() => {
    if (!searchTerm.trim()) return activeScans;
    const term = searchTerm.toLowerCase();
    return activeScans.filter(item => 
      String(item.lote || '').toLowerCase().includes(term) ||
      String(item.composto || '').toLowerCase().includes(term) ||
      String(item.unidade || '').toLowerCase().includes(term)
    );
  }, [activeScans, searchTerm]);

  const filteredSavedItems = useMemo(() => {
    if (!selectedReport || !selectedReport.items) return [];
    if (!searchTerm.trim()) return selectedReport.items;
    const term = searchTerm.toLowerCase();
    return selectedReport.items.filter(item => 
      String(item.lote || '').toLowerCase().includes(term) ||
      String(item.composto || '').toLowerCase().includes(term) ||
      String(item.unidade || '').toLowerCase().includes(term)
    );
  }, [selectedReport, searchTerm]);

  return (
    <div className="min-h-screen bg-[#f3f4f6] flex flex-col items-center pb-12">
      
      {/* Save Modal */}
      {showSaveModal && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 backdrop-blur-sm">
          <Card className="w-full max-w-md p-6 bg-white animate-in fade-in zoom-in duration-200 shadow-2xl">
            <h3 className="text-xl font-bold text-neutral-900 mb-2 flex items-center gap-2">
              <Save className="h-6 w-6 text-[#009988]" />
              Salvar Relatório do Inventário
            </h3>
            <p className="text-sm text-neutral-500 mb-4">
              Este inventário será arquivado de forma permanente com todos os {activeScans.length} lotes lidos, gráficos e estatísticas.
            </p>
            <div className="mb-6">
              <label className="block text-xs font-semibold text-neutral-700 uppercase tracking-wider mb-2">
                Título do Inventário
              </label>
              <input
                type="text"
                value={saveTitle}
                onChange={(e) => setSaveTitle(e.target.value)}
                placeholder="Ex: Inventário Caixas - 29/09/2026"
                className="w-full border border-neutral-300 rounded-lg p-3 text-sm focus:ring-2 focus:ring-[#009988] focus:border-[#009988] outline-none"
              />
            </div>
            <div className="flex gap-3 justify-end">
              <Button 
                variant="outline" 
                onClick={() => setShowSaveModal(false)}
                disabled={isSaving}
                className="flex-1"
              >
                Cancelar
              </Button>
              <Button 
                onClick={handleConfirmSave}
                disabled={isSaving}
                className="flex-1 bg-[#009988] hover:bg-[#008877] text-white flex items-center justify-center gap-2 font-semibold"
              >
                {isSaving ? "Salvando..." : "Salvar no Histórico"}
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* Save Success & Next Step Modal */}
      {showSaveSuccessModal && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 backdrop-blur-sm">
          <Card className="w-full max-w-md p-6 bg-white animate-in fade-in zoom-in duration-200 shadow-2xl">
            <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mb-4 mx-auto">
              <CheckCircle2 className="h-8 w-8" />
            </div>
            <h3 className="text-xl font-bold text-center text-neutral-900 mb-2">
              Relatório Salvo com Sucesso!
            </h3>
            <p className="text-sm text-center text-neutral-500 mb-6">
              O relatório agora está guardado no <strong>Histórico de Relatórios</strong> para consulta a qualquer momento. O que você deseja fazer agora?
            </p>
            <div className="space-y-3">
              <Button 
                onClick={handleClearActiveScans}
                className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-semibold flex items-center justify-center gap-2 py-3"
              >
                <Sparkles className="h-4 w-4" />
                Limpar Scanner e Iniciar Novo Lote
              </Button>
              <Button 
                variant="outline"
                onClick={() => {
                  setShowSaveSuccessModal(false);
                  setActiveTab('history');
                }}
                className="w-full py-3"
              >
                Manter Leituras Atuais e Ver Histórico
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {reportToDelete && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 backdrop-blur-sm">
          <Card className="w-full max-w-sm p-6 bg-white animate-in fade-in zoom-in duration-200">
            <h3 className="text-xl font-bold text-neutral-900 mb-2">Excluir Relatório Salvo?</h3>
            <p className="text-sm text-neutral-500 mb-6">
              Tem certeza que deseja apagar o relatório <strong>"{reportToDelete.title}"</strong> ({reportToDelete.dateFormatted})? Esta ação não pode ser desfeita.
            </p>
            <div className="flex gap-3 justify-end">
              <Button variant="outline" onClick={() => setReportToDelete(null)} className="flex-1">
                Cancelar
              </Button>
              <Button onClick={confirmDeleteReport} className="flex-1 bg-red-500 hover:bg-red-600 text-white">
                Excluir
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* Header */}
      <header className="bg-white w-full shadow-sm sticky top-0 z-20 px-4 sm:px-6 h-16 flex items-center justify-between border-b border-neutral-200">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate('/')}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h2 className="font-semibold text-lg text-neutral-900 flex items-center gap-2">
              <BarChart2 className="h-5 w-5 text-[#f59e0b]" />
              Relatórios de Inventário
            </h2>
          </div>
        </div>

        {/* Global actions per active tab */}
        <div className="flex items-center gap-2">
          {activeTab === 'active' && activeScans.length > 0 && (
            <>
              <Button 
                onClick={handleOpenSaveModal} 
                className="bg-[#009988] hover:bg-[#008877] text-white text-xs sm:text-sm font-semibold flex items-center gap-2 shadow-sm"
              >
                <Save className="h-4 w-4" />
                <span className="hidden sm:inline">Salvar no Histórico</span>
                <span className="sm:hidden">Salvar</span>
              </Button>
              <Button variant="outline" size="sm" onClick={exportActiveCSV} className="flex items-center gap-1.5 text-xs sm:text-sm">
                <Download className="h-4 w-4" />
                <span className="hidden sm:inline">Exportar CSV</span>
              </Button>
            </>
          )}

          {activeTab === 'history' && selectedReport && (
            <Button 
              variant="outline" 
              size="sm" 
              onClick={() => exportSavedReportCSV(selectedReport)}
              className="flex items-center gap-1.5 text-xs sm:text-sm"
            >
              <Download className="h-4 w-4" />
              <span className="hidden sm:inline">Baixar Planilha CSV</span>
              <span className="sm:hidden">CSV</span>
            </Button>
          )}

          {activeTab === 'summary' && savedReports.length > 0 && (
            <Button 
              variant="outline" 
              size="sm" 
              onClick={exportAllConsolidatedCSV}
              className="flex items-center gap-1.5 text-xs sm:text-sm font-semibold text-[#2941CC] border-[#2941CC]/30 hover:bg-[#2941CC]/10"
            >
              <FileSpreadsheet className="h-4 w-4" />
              <span className="hidden sm:inline">Exportar Planilha Geral</span>
              <span className="sm:hidden">CSV Geral</span>
            </Button>
          )}
        </div>
      </header>

      {/* Tab Switcher (3 Tabs) */}
      <div className="w-full max-w-6xl px-4 sm:px-6 mt-6">
        <div className="bg-neutral-200/80 p-1.5 rounded-2xl flex max-w-2xl mx-auto shadow-inner">
          {/* Tab 1: Inventário Atual */}
          <button
            onClick={() => {
              setActiveTab('active');
              setSelectedReport(null);
            }}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl text-xs sm:text-sm font-semibold transition-all ${
              activeTab === 'active'
                ? 'bg-white text-neutral-900 shadow-sm'
                : 'text-neutral-600 hover:text-neutral-900'
            }`}
          >
            <Activity className="h-4 w-4 text-[#2941CC]" />
            <span className="hidden sm:inline">Inventário</span>
            <span>Atual</span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${
              activeTab === 'active' ? 'bg-[#2941CC] text-white' : 'bg-neutral-300 text-neutral-700'
            }`}>
              {activeScans.length}
            </span>
          </button>

          {/* Tab 2: Histórico Salvo */}
          <button
            onClick={() => setActiveTab('history')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl text-xs sm:text-sm font-semibold transition-all ${
              activeTab === 'history'
                ? 'bg-white text-neutral-900 shadow-sm'
                : 'text-neutral-600 hover:text-neutral-900'
            }`}
          >
            <FolderArchive className="h-4 w-4 text-[#009988]" />
            <span className="hidden sm:inline">Histórico</span>
            <span>Salvo</span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${
              activeTab === 'history' ? 'bg-[#009988] text-white' : 'bg-neutral-300 text-neutral-700'
            }`}>
              {savedReports.length}
            </span>
          </button>

          {/* Tab 3: Resumo Geral Consolidado */}
          <button
            onClick={() => {
              setActiveTab('summary');
              setSelectedReport(null);
            }}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl text-xs sm:text-sm font-semibold transition-all ${
              activeTab === 'summary'
                ? 'bg-white text-neutral-900 shadow-sm'
                : 'text-neutral-600 hover:text-neutral-900'
            }`}
          >
            <TrendingUp className="h-4 w-4 text-[#8b5cf6]" />
            <span className="hidden sm:inline">Resumo</span>
            <span>Geral</span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${
              activeTab === 'summary' ? 'bg-[#8b5cf6] text-white' : 'bg-neutral-300 text-neutral-700'
            }`}>
              {consolidatedAnalytics.totalBoxes} un
            </span>
          </button>
        </div>
      </div>

      <main className="w-full max-w-6xl px-4 sm:px-6 mt-6 space-y-6">

        {/* ============================================================== */}
        {/* TAB 1: INVENTÁRIO ATIVO                                        */}
        {/* ============================================================== */}
        {activeTab === 'active' && (
          <>
            {activeScans.length > 0 ? (
              <div className="bg-gradient-to-r from-blue-50 to-emerald-50 border border-blue-200/80 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-sm">
                <div className="flex items-start gap-3">
                  <div className="p-2.5 bg-blue-600 text-white rounded-lg shadow-sm">
                    <Activity className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-neutral-900 text-sm sm:text-base">
                      Inventário Ativo em Andamento ({activeScans.length} caixas)
                    </h3>
                    <p className="text-xs text-neutral-600 mt-0.5 max-w-xl">
                      Estas são as leituras abertas no scanner agora. Salve o relatório no histórico permanente para guardar os dados deste dia mesmo se você limpar o scanner depois!
                    </p>
                  </div>
                </div>
                <Button 
                  onClick={handleOpenSaveModal}
                  className="bg-[#009988] hover:bg-[#008877] text-white text-xs sm:text-sm font-bold flex items-center justify-center gap-2 shadow-sm shrink-0"
                >
                  <Save className="h-4 w-4" />
                  Salvar Relatório do Dia
                </Button>
              </div>
            ) : (
              <Card className="bg-white p-8 text-center border-dashed border-2 border-neutral-300">
                <div className="w-16 h-16 rounded-full bg-neutral-100 text-neutral-400 flex items-center justify-center mx-auto mb-4">
                  <Box className="h-8 w-8" />
                </div>
                <h3 className="text-lg font-bold text-neutral-800 mb-1">
                  Nenhuma leitura ativa no scanner no momento
                </h3>
                <p className="text-sm text-neutral-500 max-w-md mx-auto mb-6">
                  Se você acabou de limpar o scanner, os inventários anteriores continuam salvos com segurança no Histórico de Relatórios.
                </p>
                <div className="flex flex-wrap gap-3 justify-center">
                  <Button 
                    onClick={() => setActiveTab('history')}
                    className="bg-[#009988] hover:bg-[#008877] text-white font-semibold flex items-center gap-2"
                  >
                    <FolderArchive className="h-4 w-4" />
                    Consultar Histórico Salvo ({savedReports.length})
                  </Button>
                  <Button 
                    onClick={() => setActiveTab('summary')}
                    className="bg-[#8b5cf6] hover:bg-[#7c3aed] text-white font-semibold flex items-center gap-2"
                  >
                    <TrendingUp className="h-4 w-4" />
                    Ver Resumo Geral Consolidado
                  </Button>
                  <Button 
                    variant="outline"
                    onClick={() => navigate('/scanner-caixas')}
                    className="flex items-center gap-2"
                  >
                    Ir para Scanner Caixas
                  </Button>
                </div>
              </Card>
            )}

            {activeScans.length > 0 && (
              <>
                {/* KPI Row */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <Card className="bg-white border-l-4 border-l-[#2941CC] shadow-sm">
                    <CardHeader className="pb-2">
                      <CardDescription className="font-semibold text-neutral-500">Total de Caixas Lidas</CardDescription>
                      <CardTitle className="text-3xl sm:text-4xl text-neutral-900 flex items-center gap-2">
                        <Box className="h-6 w-6 text-[#2941CC]" />
                        {activeAnalytics.totalItems}
                      </CardTitle>
                    </CardHeader>
                  </Card>
                  
                  <Card className="bg-white border-l-4 border-l-[#009988] shadow-sm">
                    <CardHeader className="pb-2">
                      <CardDescription className="font-semibold text-neutral-500">Variedade de Katames</CardDescription>
                      <CardTitle className="text-3xl sm:text-4xl text-neutral-900 flex items-center gap-2">
                        <PieChart className="h-6 w-6 text-[#009988]" />
                        {activeAnalytics.byKatame.length}
                      </CardTitle>
                    </CardHeader>
                  </Card>
                  
                  <Card className="bg-white border-l-4 border-l-[#f59e0b] shadow-sm">
                    <CardHeader className="pb-2">
                      <CardDescription className="font-semibold text-neutral-500">Locais Mapeados</CardDescription>
                      <CardTitle className="text-3xl sm:text-4xl text-neutral-900 flex items-center gap-2">
                        <Activity className="h-6 w-6 text-[#f59e0b]" />
                        {activeAnalytics.byLocal.length}
                      </CardTitle>
                    </CardHeader>
                  </Card>
                </div>

                {/* Charts Row */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Katame Distribution */}
                  <Card className="shadow-sm">
                    <CardHeader>
                      <CardTitle className="text-base sm:text-lg">Distribuição por Katame</CardTitle>
                      <CardDescription>Volume de inventário por tipo de composto</CardDescription>
                    </CardHeader>
                    <CardContent>
                      {activeAnalytics.byKatame.length === 0 ? (
                        <div className="h-[280px] flex items-center justify-center text-neutral-400">Sem dados suficientes</div>
                      ) : (
                        <div className="h-[280px] w-full">
                          <ResponsiveContainer width="100%" height="100%">
                            <RePieChart>
                              <Pie
                                data={activeAnalytics.byKatame}
                                cx="50%"
                                cy="50%"
                                innerRadius={55}
                                outerRadius={95}
                                paddingAngle={2}
                                dataKey="count"
                              >
                                {activeAnalytics.byKatame.map((entry, index) => (
                                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                ))}
                              </Pie>
                              <RechartsTooltip />
                              <Legend />
                            </RePieChart>
                          </ResponsiveContainer>
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  {/* Local Distribution */}
                  <Card className="shadow-sm">
                    <CardHeader>
                      <CardTitle className="text-base sm:text-lg">Inventário por Local</CardTitle>
                      <CardDescription>Quantidade de caixas por unidade armazenada</CardDescription>
                    </CardHeader>
                    <CardContent>
                      {activeAnalytics.byLocal.length === 0 ? (
                        <div className="h-[280px] flex items-center justify-center text-neutral-400">Sem dados suficientes</div>
                      ) : (
                        <div className="h-[280px] w-full">
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={activeAnalytics.byLocal} margin={{ top: 20, right: 30, left: 0, bottom: 5 }}>
                              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                              <XAxis dataKey="name" tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
                              <YAxis tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
                              <RechartsTooltip cursor={{ fill: '#f3f4f6' }} />
                              <Bar dataKey="count" fill="#2941CC" radius={[4, 4, 0, 0]} />
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>

                {/* Items Table */}
                <Card className="shadow-sm overflow-hidden">
                  <CardHeader className="border-b border-neutral-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                      <CardTitle className="text-base sm:text-lg">Listagem das Caixas Ativas</CardTitle>
                      <CardDescription>Todos os lotes registrados no lote atual</CardDescription>
                    </div>
                    <div className="relative w-full sm:w-64">
                      <Search className="absolute left-3 top-2.5 h-4 w-4 text-neutral-400" />
                      <input
                        type="text"
                        placeholder="Buscar lote, katame, local..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full pl-9 pr-4 py-2 text-xs border border-neutral-200 rounded-lg outline-none focus:border-[#2941CC]"
                      />
                    </div>
                  </CardHeader>
                  <div className="overflow-x-auto max-h-[400px]">
                    <table className="w-full text-left text-xs sm:text-sm">
                      <thead className="bg-neutral-50 text-neutral-600 font-semibold sticky top-0 border-b border-neutral-200">
                        <tr>
                          <th className="p-3">#</th>
                          <th className="p-3">Lote (Código)</th>
                          <th className="p-3">Katame</th>
                          <th className="p-3">Local</th>
                          <th className="p-3">Data / Hora</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-neutral-100">
                        {filteredActiveItems.map((item, idx) => (
                          <tr key={item.id || idx} className="hover:bg-neutral-50/80 transition-colors">
                            <td className="p-3 text-neutral-400 font-mono">{idx + 1}</td>
                            <td className="p-3 font-mono font-bold text-neutral-900">{item.lote}</td>
                            <td className="p-3">
                              <span className="inline-block bg-[#2941CC]/10 text-[#2941CC] font-bold px-2 py-0.5 rounded text-xs">
                                {item.composto}
                              </span>
                            </td>
                            <td className="p-3">
                              <span className="inline-block bg-emerald-100 text-emerald-800 font-bold px-2 py-0.5 rounded text-xs">
                                {item.unidade}
                              </span>
                            </td>
                            <td className="p-3 text-neutral-500 text-xs">
                              {item.scannedAt?.toDate ? item.scannedAt.toDate().toLocaleString('pt-BR') : 'Agora'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              </>
            )}
          </>
        )}

        {/* ============================================================== */}
        {/* TAB 2: HISTÓRICO SALVO                                         */}
        {/* ============================================================== */}
        {activeTab === 'history' && (
          <>
            {/* View single selected historical report */}
            {selectedReport ? (
              <div className="space-y-6">
                {/* Back bar */}
                <div className="bg-white p-4 rounded-xl shadow-sm border border-neutral-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <Button 
                      variant="outline" 
                      size="sm" 
                      onClick={() => {
                        setSelectedReport(null);
                        setSearchTerm('');
                      }}
                      className="flex items-center gap-1.5"
                    >
                      <ArrowLeft className="h-4 w-4" />
                      <span>Voltar à Lista</span>
                    </Button>
                    <div>
                      <h3 className="font-bold text-base sm:text-lg text-neutral-900">
                        {selectedReport.title}
                      </h3>
                      <div className="flex items-center gap-3 text-xs text-neutral-500 mt-0.5">
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3.5 w-3.5 text-neutral-400" />
                          {selectedReport.dateFormatted}
                        </span>
                        {selectedReport.timeFormatted && (
                          <span className="flex items-center gap-1">
                            <Clock className="h-3.5 w-3.5 text-neutral-400" />
                            {selectedReport.timeFormatted}
                          </span>
                        )}
                        <span className="bg-emerald-100 text-emerald-800 font-bold px-2 py-0.5 rounded text-[11px]">
                          {selectedReport.totalItems} caixas
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <Button 
                      onClick={() => exportSavedReportCSV(selectedReport)}
                      className="bg-[#2941CC] hover:bg-[#1f32a8] text-white text-xs sm:text-sm flex items-center gap-1.5"
                    >
                      <Download className="h-4 w-4" />
                      Baixar Planilha CSV
                    </Button>
                  </div>
                </div>

                {/* KPI Row for Selected Report */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <Card className="bg-white border-l-4 border-l-[#2941CC] shadow-sm">
                    <CardHeader className="pb-2">
                      <CardDescription className="font-semibold text-neutral-500">Total de Caixas no Inventário</CardDescription>
                      <CardTitle className="text-3xl sm:text-4xl text-neutral-900 flex items-center gap-2">
                        <Box className="h-6 w-6 text-[#2941CC]" />
                        {selectedReport.totalItems}
                      </CardTitle>
                    </CardHeader>
                  </Card>
                  
                  <Card className="bg-white border-l-4 border-l-[#009988] shadow-sm">
                    <CardHeader className="pb-2">
                      <CardDescription className="font-semibold text-neutral-500">Katames Registrados</CardDescription>
                      <CardTitle className="text-3xl sm:text-4xl text-neutral-900 flex items-center gap-2">
                        <PieChart className="h-6 w-6 text-[#009988]" />
                        {selectedReport.byKatame?.length || 0}
                      </CardTitle>
                    </CardHeader>
                  </Card>
                  
                  <Card className="bg-white border-l-4 border-l-[#f59e0b] shadow-sm">
                    <CardHeader className="pb-2">
                      <CardDescription className="font-semibold text-neutral-500">Locais Mapeados</CardDescription>
                      <CardTitle className="text-3xl sm:text-4xl text-neutral-900 flex items-center gap-2">
                        <Activity className="h-6 w-6 text-[#f59e0b]" />
                        {selectedReport.byLocal?.length || 0}
                      </CardTitle>
                    </CardHeader>
                  </Card>
                </div>

                {/* Charts Row for Selected Report */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Katame Distribution */}
                  <Card className="shadow-sm">
                    <CardHeader>
                      <CardTitle className="text-base sm:text-lg">Distribuição por Katame</CardTitle>
                      <CardDescription>Volume deste inventário histórico</CardDescription>
                    </CardHeader>
                    <CardContent>
                      {(!selectedReport.byKatame || selectedReport.byKatame.length === 0) ? (
                        <div className="h-[280px] flex items-center justify-center text-neutral-400">Sem dados</div>
                      ) : (
                        <div className="h-[280px] w-full">
                          <ResponsiveContainer width="100%" height="100%">
                            <RePieChart>
                              <Pie
                                data={selectedReport.byKatame}
                                cx="50%"
                                cy="50%"
                                innerRadius={55}
                                outerRadius={95}
                                paddingAngle={2}
                                dataKey="count"
                              >
                                {selectedReport.byKatame.map((entry, index) => (
                                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                ))}
                              </Pie>
                              <RechartsTooltip />
                              <Legend />
                            </RePieChart>
                          </ResponsiveContainer>
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  {/* Local Distribution */}
                  <Card className="shadow-sm">
                    <CardHeader>
                      <CardTitle className="text-base sm:text-lg">Inventário por Local</CardTitle>
                      <CardDescription>Volume por unidade armazenada</CardDescription>
                    </CardHeader>
                    <CardContent>
                      {(!selectedReport.byLocal || selectedReport.byLocal.length === 0) ? (
                        <div className="h-[280px] flex items-center justify-center text-neutral-400">Sem dados</div>
                      ) : (
                        <div className="h-[280px] w-full">
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={selectedReport.byLocal} margin={{ top: 20, right: 30, left: 0, bottom: 5 }}>
                              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                              <XAxis dataKey="name" tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
                              <YAxis tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
                              <RechartsTooltip cursor={{ fill: '#f3f4f6' }} />
                              <Bar dataKey="count" fill="#2941CC" radius={[4, 4, 0, 0]} />
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>

                {/* Full Historical Items Table */}
                <Card className="shadow-sm overflow-hidden">
                  <CardHeader className="border-b border-neutral-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                      <CardTitle className="text-base sm:text-lg">Caixas Deste Inventário ({selectedReport.items?.length || 0})</CardTitle>
                      <CardDescription>Relação completa registrada neste dia</CardDescription>
                    </div>
                    <div className="relative w-full sm:w-64">
                      <Search className="absolute left-3 top-2.5 h-4 w-4 text-neutral-400" />
                      <input
                        type="text"
                        placeholder="Buscar lote, katame, local..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full pl-9 pr-4 py-2 text-xs border border-neutral-200 rounded-lg outline-none focus:border-[#2941CC]"
                      />
                    </div>
                  </CardHeader>
                  <div className="overflow-x-auto max-h-[400px]">
                    <table className="w-full text-left text-xs sm:text-sm">
                      <thead className="bg-neutral-50 text-neutral-600 font-semibold sticky top-0 border-b border-neutral-200">
                        <tr>
                          <th className="p-3">#</th>
                          <th className="p-3">Lote (Código)</th>
                          <th className="p-3">Katame</th>
                          <th className="p-3">Local</th>
                          <th className="p-3">Hora da Leitura</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-neutral-100">
                        {filteredSavedItems.map((item, idx) => (
                          <tr key={idx} className="hover:bg-neutral-50/80 transition-colors">
                            <td className="p-3 text-neutral-400 font-mono">{idx + 1}</td>
                            <td className="p-3 font-mono font-bold text-neutral-900">{item.lote}</td>
                            <td className="p-3">
                              <span className="inline-block bg-[#2941CC]/10 text-[#2941CC] font-bold px-2 py-0.5 rounded text-xs">
                                {item.composto}
                              </span>
                            </td>
                            <td className="p-3">
                              <span className="inline-block bg-emerald-100 text-emerald-800 font-bold px-2 py-0.5 rounded text-xs">
                                {item.unidade}
                              </span>
                            </td>
                            <td className="p-3 text-neutral-500 text-xs">
                              {item.scannedAt || '-'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              </div>
            ) : (
              /* Listing of all saved reports */
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-bold text-neutral-900">
                      Relatórios de Inventário Salvos
                    </h3>
                    <p className="text-xs sm:text-sm text-neutral-500">
                      Histórico permanente de todos os dias de inventário realizados.
                    </p>
                  </div>
                </div>

                {loadingHistory ? (
                  <div className="bg-white p-8 rounded-xl text-center text-neutral-400">
                    Carregando histórico...
                  </div>
                ) : savedReports.length === 0 ? (
                  <Card className="bg-white p-8 text-center border-dashed border-2 border-neutral-300">
                    <div className="w-16 h-16 rounded-full bg-neutral-100 text-neutral-400 flex items-center justify-center mx-auto mb-4">
                      <History className="h-8 w-8" />
                    </div>
                    <h4 className="text-lg font-bold text-neutral-800 mb-1">
                      Nenhum relatório salvo no histórico ainda
                    </h4>
                    <p className="text-sm text-neutral-500 max-w-md mx-auto mb-6">
                      Quando você finalizar um inventário no scanner, clique no botão <strong>"Salvar no Histórico"</strong> para guardar os registros deste dia para sempre.
                    </p>
                    {activeScans.length > 0 && (
                      <Button 
                        onClick={() => {
                          setActiveTab('active');
                          handleOpenSaveModal();
                        }}
                        className="bg-[#009988] hover:bg-[#008877] text-white font-semibold flex items-center gap-2 mx-auto"
                      >
                        <Save className="h-4 w-4" />
                        Salvar o Inventário Ativo Agora ({activeScans.length} caixas)
                      </Button>
                    )}
                  </Card>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {savedReports.map((report) => (
                      <Card 
                        key={report.id} 
                        className="p-5 hover:shadow-md transition-shadow border-neutral-200/80 bg-white flex flex-col justify-between"
                      >
                        <div>
                          <div className="flex items-start justify-between gap-2 mb-2">
                            <h4 className="font-bold text-base text-neutral-900 line-clamp-1">
                              {report.title}
                            </h4>
                            <Button 
                              variant="ghost" 
                              size="icon" 
                              onClick={() => setReportToDelete(report)}
                              className="h-8 w-8 text-neutral-400 hover:text-red-500 -mr-2 -mt-2"
                              title="Excluir este relatório do histórico"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>

                          <div className="flex items-center gap-3 text-xs text-neutral-500 mb-4">
                            <span className="flex items-center gap-1">
                              <Calendar className="h-3.5 w-3.5 text-neutral-400" />
                              {report.dateFormatted}
                            </span>
                            {report.timeFormatted && (
                              <span className="flex items-center gap-1">
                                <Clock className="h-3.5 w-3.5 text-neutral-400" />
                                {report.timeFormatted}
                              </span>
                            )}
                          </div>

                          {/* Quick Chips */}
                          <div className="flex flex-wrap gap-2 mb-4">
                            <span className="bg-blue-50 text-blue-700 font-bold px-2.5 py-1 rounded-md text-xs border border-blue-100 flex items-center gap-1">
                              <Box className="h-3.5 w-3.5" />
                              {report.totalItems} caixas
                            </span>
                            <span className="bg-emerald-50 text-emerald-700 font-bold px-2.5 py-1 rounded-md text-xs border border-emerald-100 flex items-center gap-1">
                              <PieChart className="h-3.5 w-3.5" />
                              {report.byKatame?.length || 0} Katames
                            </span>
                            <span className="bg-amber-50 text-amber-700 font-bold px-2.5 py-1 rounded-md text-xs border border-amber-100 flex items-center gap-1">
                              <Activity className="h-3.5 w-3.5" />
                              {report.byLocal?.length || 0} Locais
                            </span>
                          </div>
                        </div>

                        {/* Actions */}
                        <div className="flex gap-2 pt-3 border-t border-neutral-100">
                          <Button 
                            onClick={() => {
                              setSelectedReport(report);
                              setSearchTerm('');
                            }}
                            className="flex-1 bg-neutral-900 hover:bg-neutral-800 text-white text-xs font-semibold flex items-center justify-center gap-1.5"
                          >
                            <Eye className="h-3.5 w-3.5" />
                            Visualizar Gráficos
                          </Button>
                          <Button 
                            variant="outline" 
                            onClick={() => exportSavedReportCSV(report)}
                            className="text-xs font-semibold flex items-center gap-1 text-neutral-700 border-neutral-300"
                            title="Baixar Planilha CSV deste dia"
                          >
                            <Download className="h-3.5 w-3.5" />
                            CSV
                          </Button>
                        </div>
                      </Card>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* ============================================================== */}
        {/* TAB 3: RESUMO GERAL CONSOLIDADO DE TODOS OS INVENTÁRIOS        */}
        {/* ============================================================== */}
        {activeTab === 'summary' && (
          <div className="space-y-6">
            {savedReports.length === 0 ? (
              <Card className="bg-white p-8 text-center border-dashed border-2 border-neutral-300">
                <div className="w-16 h-16 rounded-full bg-purple-100 text-purple-600 flex items-center justify-center mx-auto mb-4">
                  <TrendingUp className="h-8 w-8" />
                </div>
                <h3 className="text-lg font-bold text-neutral-800 mb-1">
                  Nenhum inventário consolidado ainda
                </h3>
                <p className="text-sm text-neutral-500 max-w-md mx-auto mb-6">
                  Conforme você for realizando inventários e salvando no histórico, este painel apresentará gráficos comparativos gerais, médias acumuladas, evolução temporal e o ranking consolidado de todos os compostos e locais.
                </p>
                {activeScans.length > 0 && (
                  <Button 
                    onClick={() => {
                      setActiveTab('active');
                      handleOpenSaveModal();
                    }}
                    className="bg-[#009988] hover:bg-[#008877] text-white font-semibold flex items-center gap-2 mx-auto"
                  >
                    <Save className="h-4 w-4" />
                    Salvar o Inventário Ativo Agora ({activeScans.length} caixas)
                  </Button>
                )}
              </Card>
            ) : (
              <>
                {/* Hero / Banner */}
                <div className="bg-gradient-to-r from-purple-900 via-indigo-900 to-blue-900 text-white rounded-2xl p-6 sm:p-8 shadow-lg relative overflow-hidden">
                  <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
                    <div>
                      <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/10 backdrop-blur-md text-xs font-semibold text-purple-200 border border-white/10 mb-3">
                        <Award className="h-3.5 w-3.5 text-amber-300" />
                        Visão Executiva & Consolidada
                      </div>
                      <h3 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
                        Panorama Geral dos Inventários
                      </h3>
                      <p className="text-neutral-300 text-xs sm:text-sm mt-1.5 max-w-xl">
                        Métricas consolidadas de <strong>{consolidatedAnalytics.totalInventories} inventários realizados</strong>, somando <strong>{consolidatedAnalytics.totalBoxes} caixas registradas</strong> no total acumulado.
                      </p>
                    </div>

                    <div className="flex flex-wrap gap-3">
                      <Button 
                        onClick={exportAllConsolidatedCSV}
                        className="bg-white hover:bg-neutral-100 text-neutral-900 font-bold text-xs sm:text-sm flex items-center gap-2 shadow-md"
                      >
                        <FileSpreadsheet className="h-4 w-4 text-[#2941CC]" />
                        Baixar Planilha Consolidada
                      </Button>
                    </div>
                  </div>

                  {/* Background glow decoration */}
                  <div className="absolute -right-16 -bottom-16 w-64 h-64 rounded-full bg-purple-500/10 blur-3xl pointer-events-none" />
                </div>

                {/* 4 KPIs Row */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
                  {/* Total Geral */}
                  <Card className="bg-white border-l-4 border-l-[#2941CC] shadow-sm">
                    <CardHeader className="pb-1 p-4 sm:p-6">
                      <CardDescription className="text-xs font-semibold text-neutral-500">
                        Total Geral Acumulado
                      </CardDescription>
                      <CardTitle className="text-2xl sm:text-3xl font-black text-neutral-900 flex items-center gap-2 mt-1">
                        <Box className="h-5 w-5 sm:h-6 sm:w-6 text-[#2941CC]" />
                        {consolidatedAnalytics.totalBoxes}
                      </CardTitle>
                      <p className="text-[11px] text-neutral-400 mt-1">caixas bipadas no histórico</p>
                    </CardHeader>
                  </Card>

                  {/* Sessões Realizadas */}
                  <Card className="bg-white border-l-4 border-l-[#8b5cf6] shadow-sm">
                    <CardHeader className="pb-1 p-4 sm:p-6">
                      <CardDescription className="text-xs font-semibold text-neutral-500">
                        Inventários Realizados
                      </CardDescription>
                      <CardTitle className="text-2xl sm:text-3xl font-black text-neutral-900 flex items-center gap-2 mt-1">
                        <Calendar className="h-5 w-5 sm:h-6 sm:w-6 text-[#8b5cf6]" />
                        {consolidatedAnalytics.totalInventories}
                      </CardTitle>
                      <p className="text-[11px] text-neutral-400 mt-1">dias/sessões arquivadas</p>
                    </CardHeader>
                  </Card>

                  {/* Média por Inventário */}
                  <Card className="bg-white border-l-4 border-l-[#009988] shadow-sm">
                    <CardHeader className="pb-1 p-4 sm:p-6">
                      <CardDescription className="text-xs font-semibold text-neutral-500">
                        Média por Inventário
                      </CardDescription>
                      <CardTitle className="text-2xl sm:text-3xl font-black text-neutral-900 flex items-center gap-2 mt-1">
                        <TrendingUp className="h-5 w-5 sm:h-6 sm:w-6 text-[#009988]" />
                        {consolidatedAnalytics.avgBoxesPerInventory}
                      </CardTitle>
                      <p className="text-[11px] text-neutral-400 mt-1">caixas em média por lote</p>
                    </CardHeader>
                  </Card>

                  {/* Variedade de Katames */}
                  <Card className="bg-white border-l-4 border-l-[#f59e0b] shadow-sm">
                    <CardHeader className="pb-1 p-4 sm:p-6">
                      <CardDescription className="text-xs font-semibold text-neutral-500">
                        Compostos Mapeados
                      </CardDescription>
                      <CardTitle className="text-2xl sm:text-3xl font-black text-neutral-900 flex items-center gap-2 mt-1">
                        <PieChart className="h-5 w-5 sm:h-6 sm:w-6 text-[#f59e0b]" />
                        {consolidatedAnalytics.uniqueKatamesCount}
                      </CardTitle>
                      <p className="text-[11px] text-neutral-400 mt-1">katames em {consolidatedAnalytics.uniqueLocaisCount} locais</p>
                    </CardHeader>
                  </Card>
                </div>

                {/* Spotlights (Destaques Gerais) */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
                  {/* Top Katame */}
                  <Card className="bg-gradient-to-br from-blue-50/60 to-white border border-blue-200/60 shadow-sm p-5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="p-2.5 rounded-xl bg-[#2941CC] text-white shadow-sm">
                          <Award className="h-6 w-6" />
                        </div>
                        <div>
                          <p className="text-xs font-bold text-neutral-500 uppercase tracking-wider">
                            Composto Mais Frequente (Geral)
                          </p>
                          <h4 className="text-xl font-extrabold text-[#2941CC] mt-0.5">
                            {consolidatedAnalytics.topKatame?.name || 'N/A'}
                          </h4>
                        </div>
                      </div>
                      <div className="text-right">
                        <span className="text-2xl font-black text-neutral-900">
                          {consolidatedAnalytics.topKatame?.count || 0}
                        </span>
                        <p className="text-xs text-neutral-500">
                          {consolidatedAnalytics.topKatame?.percentage || 0}% de todas as caixas
                        </p>
                      </div>
                    </div>
                  </Card>

                  {/* Top Local */}
                  <Card className="bg-gradient-to-br from-emerald-50/60 to-white border border-emerald-200/60 shadow-sm p-5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="p-2.5 rounded-xl bg-[#009988] text-white shadow-sm">
                          <Layers className="h-6 w-6" />
                        </div>
                        <div>
                          <p className="text-xs font-bold text-neutral-500 uppercase tracking-wider">
                            Local com Maior Ocupação (Geral)
                          </p>
                          <h4 className="text-xl font-extrabold text-[#009988] mt-0.5">
                            {consolidatedAnalytics.topLocal?.name || 'N/A'}
                          </h4>
                        </div>
                      </div>
                      <div className="text-right">
                        <span className="text-2xl font-black text-neutral-900">
                          {consolidatedAnalytics.topLocal?.count || 0}
                        </span>
                        <p className="text-xs text-neutral-500">
                          {consolidatedAnalytics.topLocal?.percentage || 0}% de todas as caixas
                        </p>
                      </div>
                    </div>
                  </Card>
                </div>

                {/* Gráfico 1: Evolução Histórica dos Inventários */}
                <Card className="shadow-sm">
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle className="text-base sm:text-lg flex items-center gap-2">
                          <TrendingUp className="h-5 w-5 text-[#8b5cf6]" />
                          Evolução do Volume por Inventário Realizado
                        </CardTitle>
                        <CardDescription>
                          Histórico cronológico de caixas registradas em cada sessão de inventário
                        </CardDescription>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    {consolidatedAnalytics.timelineData.length === 0 ? (
                      <div className="h-[280px] flex items-center justify-center text-neutral-400">Sem dados</div>
                    ) : (
                      <div className="h-[280px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart data={consolidatedAnalytics.timelineData} margin={{ top: 15, right: 30, left: 0, bottom: 5 }}>
                            <defs>
                              <linearGradient id="colorCount" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.4}/>
                                <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0.0}/>
                              </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                            <XAxis dataKey="date" tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
                            <YAxis tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
                            <RechartsTooltip 
                              formatter={(value: any) => [`${value} caixas`, 'Volume']}
                              labelFormatter={(label: any) => `Data: ${label}`}
                            />
                            <Area 
                              type="monotone" 
                              dataKey="count" 
                              stroke="#8b5cf6" 
                              strokeWidth={3}
                              fillOpacity={1} 
                              fill="url(#colorCount)" 
                            />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Gráficos 2 e 3: Composição Katame e Volume por Local */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Composição Geral por Katame */}
                  <Card className="shadow-sm">
                    <CardHeader>
                      <CardTitle className="text-base sm:text-lg flex items-center gap-2">
                        <PieChart className="h-5 w-5 text-[#2941CC]" />
                        Composição Geral por Katame
                      </CardTitle>
                      <CardDescription>Participação percentual de cada composto no estoque total</CardDescription>
                    </CardHeader>
                    <CardContent>
                      {consolidatedAnalytics.byKatame.length === 0 ? (
                        <div className="h-[280px] flex items-center justify-center text-neutral-400">Sem dados</div>
                      ) : (
                        <div className="h-[280px] w-full">
                          <ResponsiveContainer width="100%" height="100%">
                            <RePieChart>
                              <Pie
                                data={consolidatedAnalytics.byKatame}
                                cx="50%"
                                cy="50%"
                                innerRadius={55}
                                outerRadius={95}
                                paddingAngle={2}
                                dataKey="count"
                              >
                                {consolidatedAnalytics.byKatame.map((entry, index) => (
                                  <Cell key={`cell-kat-${index}`} fill={COLORS[index % COLORS.length]} />
                                ))}
                              </Pie>
                              <RechartsTooltip formatter={(value: any) => [`${value} caixas`, 'Quantidade']} />
                              <Legend />
                            </RePieChart>
                          </ResponsiveContainer>
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  {/* Volume Acumulado por Local */}
                  <Card className="shadow-sm">
                    <CardHeader>
                      <CardTitle className="text-base sm:text-lg flex items-center gap-2">
                        <BarChart3 className="h-5 w-5 text-[#009988]" />
                        Volume Acumulado por Local
                      </CardTitle>
                      <CardDescription>Total de caixas alocadas por unidade em todos os inventários</CardDescription>
                    </CardHeader>
                    <CardContent>
                      {consolidatedAnalytics.byLocal.length === 0 ? (
                        <div className="h-[280px] flex items-center justify-center text-neutral-400">Sem dados</div>
                      ) : (
                        <div className="h-[280px] w-full">
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={consolidatedAnalytics.byLocal} margin={{ top: 20, right: 30, left: 0, bottom: 5 }}>
                              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                              <XAxis dataKey="name" tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
                              <YAxis tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
                              <RechartsTooltip 
                                cursor={{ fill: '#f3f4f6' }} 
                                formatter={(value: any) => [`${value} caixas`, 'Total']}
                              />
                              <Bar dataKey="count" fill="#009988" radius={[4, 4, 0, 0]} />
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>

                {/* Ranking e Tabela Detalhada dos Compostos */}
                <Card className="shadow-sm overflow-hidden">
                  <CardHeader className="border-b border-neutral-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                      <CardTitle className="text-base sm:text-lg flex items-center gap-2">
                        <Award className="h-5 w-5 text-[#f59e0b]" />
                        Ranking Consolidado de Compostos (Katames)
                      </CardTitle>
                      <CardDescription>
                        Desempenho detalhado de cada Katame em todos os {consolidatedAnalytics.totalInventories} inventários
                      </CardDescription>
                    </div>
                  </CardHeader>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs sm:text-sm">
                      <thead className="bg-neutral-50 text-neutral-600 font-semibold border-b border-neutral-200">
                        <tr>
                          <th className="p-3 w-12 text-center">#</th>
                          <th className="p-3">Katame (Composto)</th>
                          <th className="p-3">Total de Caixas</th>
                          <th className="p-3">% do Total Geral</th>
                          <th className="p-3">Média por Inventário</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-neutral-100">
                        {consolidatedAnalytics.byKatame.map((item, idx) => (
                          <tr key={item.name} className="hover:bg-neutral-50/80 transition-colors">
                            <td className="p-3 font-bold text-center text-neutral-400">
                              {idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : idx + 1}
                            </td>
                            <td className="p-3 font-bold text-neutral-900 flex items-center gap-2">
                              <span className="inline-block bg-[#2941CC]/10 text-[#2941CC] px-2.5 py-1 rounded text-xs font-bold">
                                {item.name}
                              </span>
                            </td>
                            <td className="p-3 font-mono font-bold text-neutral-900">
                              {item.count} caixas
                            </td>
                            <td className="p-3">
                              <div className="flex items-center gap-2">
                                <div className="w-24 bg-neutral-200 rounded-full h-2 overflow-hidden">
                                  <div 
                                    className="bg-[#2941CC] h-full rounded-full" 
                                    style={{ width: `${Math.min(100, Math.max(2, parseFloat(item.percentage)))}%` }}
                                  />
                                </div>
                                <span className="font-semibold text-neutral-600 text-xs">
                                  {item.percentage}%
                                </span>
                              </div>
                            </td>
                            <td className="p-3 text-neutral-600 text-xs">
                              {(item.count / Math.max(1, consolidatedAnalytics.totalInventories)).toFixed(1)} caixas / inventário
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              </>
            )}
          </div>
        )}

      </main>
    </div>
  );
}
