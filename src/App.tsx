import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Hub } from './pages/Hub';
import { ScannerCaixas } from './pages/ScannerCaixas';
import { ScannerMantas } from './pages/ScannerMantas';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Hub />} />
        <Route path="/scanner-caixas" element={<ScannerCaixas />} />
        <Route path="/scanner-mantas" element={<ScannerMantas />} />
      </Routes>
    </BrowserRouter>
  );
}
