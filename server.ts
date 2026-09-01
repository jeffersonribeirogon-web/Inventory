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
      model: 'googleai/gemini-2.5-flash',
      messages: [
        {
          role: 'user',
          content: [
            { media: { url: imageBase64 } },
            { text: 'Extract all barcodes from this image of a box/label. Return only a JSON array of strings containing the barcode values. Do not wrap in markdown blocks, just the JSON array. Make sure you extract numbers or alphanumerics that look like part of a barcode.' }
          ]
        }
      ],
      output: { schema: z.array(z.string()) }
    });
    
    res.json({ barcodes: response.output });
  } catch (error) {
    console.error('Error processing caixa:', error);
    res.status(500).json({ error: 'Failed to process image' });
  }
});

app.post('/api/process-manta', async (req, res) => {
  try {
    const { imageBase64 } = req.body;
    
    const response = await ai.generate({
      model: 'googleai/gemini-2.5-flash',
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
