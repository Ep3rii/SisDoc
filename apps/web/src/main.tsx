import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './aplicacao/app';

const raiz = document.getElementById('root');
if (!raiz) throw new Error('Elemento principal da aplicação não encontrado.');
createRoot(raiz).render(<StrictMode><App /></StrictMode>);
