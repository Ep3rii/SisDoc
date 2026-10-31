import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './estilos.css';

function App() {
  return (
    <main className="pagina">
      <header className="cabecalho">
        <span className="marca">SisDoc</span>
        <span>Declarações funcionais</span>
      </header>
      <section className="cartao" aria-labelledby="titulo">
        <p className="etiqueta">Sistema em construção</p>
        <h1 id="titulo">DOF e DTC</h1>
        <p>
          O acesso funcional, os cálculos e a emissão de documentos ainda não estão disponíveis.
        </p>
        <p>
          A utilização operacional depende da implementação, da conferência dos dados e das
          aprovações exigidas.
        </p>
      </section>
    </main>
  );
}

const raiz = document.getElementById('root');
if (!raiz) {
  throw new Error('Elemento principal da aplicação não encontrado.');
}
createRoot(raiz).render(<StrictMode><App /></StrictMode>);
