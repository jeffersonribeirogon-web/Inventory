import express from 'express';
import path from 'path';
import { ai } from './src/ai.ts';
import { z } from 'genkit';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '50mb' }));

app.post('/api/process-caixa', async (req, res) => {
  try {
    const { imageBase64 } = req.body;
    
    const response = await ai.generate({
      model: 'googleai/gemini-3.6-flash',
      messages: [
        {
          role: 'user',
          content: [
            { media: { url: imageBase64 } },
            { text: 'Extract information from this inventory label. Return a JSON object with the following fields: "composto" (the compound name, e.g., "RET"), "lote" (the number from the first/top-most barcode, e.g., "00260830004"), "unidade" (the text physically located right below the word "Reuso". If empty, return the exact string "vazio"), "dataExpiracao" (Data de expiração, e.g., "29/10/2026").' }
          ]
        }
      ],
      output: { 
        schema: z.object({
          composto: z.string().optional().describe("Composto, ex: RET"),
          lote: z.string().optional().describe("Lote do primeiro barcode, ex: 00260830004"),
          unidade: z.string().optional().describe("Informação abaixo da escrita Reuso (se vazio, retorne 'vazio')"),
          dataExpiracao: z.string().optional().describe("Data de expiração, ex: 29/10/2026")
        })
      }
    });
    
    res.json({ data: response.output });
  } catch (error) {
    console.error('Error processing caixa:', error);
    res.status(500).json({ error: 'Failed to process image' });
  }
});

app.post('/api/process-manta', async (req, res) => {
  try {
    const { imageBase64 } = req.body;
    
    const response = await ai.generate({
      model: 'googleai/gemini-3.6-flash',
      messages: [
        {
          role: 'user',
          content: [
            { media: { url: imageBase64 } },
            { text: 'Extract the following fields from this rubber production label: NÚMERO OP (or just OP), PRODUTO, MEDIDA, PESOS, DATA, OPERADOR. Return as JSON.' }
          ]
        }
      ],
      output: {
        schema: z.object({
          numeroOp: z.string().optional().describe("NÚMERO OP"),
          produto: z.string().optional().describe("PRODUTO"),
          medida: z.string().optional().describe("MEDIDA"),
          pesos: z.string().optional().describe("PESOS"),
          data: z.string().optional().describe("DATA"),
          operador: z.string().optional().describe("OPERADOR")
        })
      }
    });
    
    res.json({ data: response.output });
  } catch (error) {
    console.error('Error processing manta:', error);
    res.status(500).json({ error: 'Failed to process image' });
  }
});

if (process.env.NODE_ENV !== "production") {
  import('vite').then(async (vite) => {
    const viteServer = await vite.createServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(viteServer.middlewares);
    app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  });
} else {
  const distPath = path.join(process.cwd(), 'dist');
  app.use(express.static(distPath));
  app.get('*', (req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
  
  if (!process.env.VERCEL) {
    app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  }
}

export default app;
