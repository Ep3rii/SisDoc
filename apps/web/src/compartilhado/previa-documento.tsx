import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export function PreviaDocumento({ html, titulo }: { html: string; titulo: string }) {
  const destino = useRef<HTMLDivElement>(null);
  const [largura, setLargura] = useState(794);
  const [modo, setModo] = useState<'largura' | 'pagina' | 'manual'>('largura');
  const [zoom, setZoom] = useState(1);
  const [ampliada, setAmpliada] = useState(false);
  const [altura, setAltura] = useState(320);
  const [proporcao, setProporcao] = useState(42.5);
  const atualizarDimensoes = useCallback(() => {
    const elemento = destino.current;
    if (!elemento) return;
    const rodape = document.querySelector('.barra-totais');
    const limite = !ampliada && rodape ? rodape.getBoundingClientRect().top : window.innerHeight - 24;
    setLargura(elemento.clientWidth);
    setAltura(!ampliada && window.innerWidth <= 800
      ? Math.max(240, Math.floor(window.innerHeight * 0.65))
      : Math.max(80, limite - elemento.getBoundingClientRect().top - 16));
  }, [ampliada]);
  useLayoutEffect(atualizarDimensoes, [atualizarDimensoes, html]);
  useEffect(() => {
    const elemento = destino.current;
    if (!elemento) return;
    const rodape = document.querySelector('.barra-totais');
    const atualizar = atualizarDimensoes;
    atualizar();
    const observer = new ResizeObserver(atualizar);
    observer.observe(elemento);
    if (elemento.parentElement) observer.observe(elemento.parentElement);
    const painel = elemento.closest('.painel-previa, .previa-documento');
    if (painel) observer.observe(painel);
    if (rodape) observer.observe(rodape);
    window.addEventListener('resize', atualizar);
    window.addEventListener('scroll', atualizar, { passive: true });
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', atualizar);
      window.removeEventListener('scroll', atualizar);
    };
  }, [atualizarDimensoes]);
  const escala = modo === 'manual' ? zoom : Math.min(largura / 794, modo === 'pagina' ? altura / 1123 : 2);
  useEffect(() => {
    if (!ampliada) return;
    const fechar = (evento: KeyboardEvent) => { if (evento.key === 'Escape') setAmpliada(false); };
    window.addEventListener('keydown', fechar);
    return () => window.removeEventListener('keydown', fechar);
  }, [ampliada]);
  const visualizador = <div className={`visualizador-previa${ampliada ? ' ampliado' : ''}`}>
    <div className="acoes controles-previa" aria-label="Exibição da prévia">
      <button type="button" className="secundario" onClick={() => setModo('largura')}>Ajustar à largura</button>
      <button type="button" className="secundario" onClick={() => setModo('pagina')}>Página inteira</button>
      <label>Zoom<select value={modo === 'manual' ? zoom : ''} onChange={(e) => { setZoom(Number(e.target.value)); setModo('manual'); }}>
        <option value="" disabled>Automático</option>
        {[0.5, 0.75, 1, 1.25, 1.5].map((valor) => <option key={valor} value={valor}>{valor * 100}%</option>)}
      </select></label>
      <button type="button" className="secundario" aria-pressed={ampliada} onClick={() => setAmpliada((v) => !v)}>
        {ampliada ? 'Recolher prévia' : 'Ampliar prévia'}
      </button>
      <label className="ajuste-paineis">Largura do editor ({proporcao}%)
        <input type="range" min="30" max="65" step="2.5" value={proporcao} onChange={(e) => {
          setProporcao(Number(e.target.value));
          destino.current?.closest<HTMLElement>('.area-dof')?.style.setProperty('--largura-editor', `${e.target.value}%`);
        }} />
      </label>
    </div>
    <div className="janela-previa" ref={destino} style={{ height: altura }}>
      <div style={{ width: 794 * escala, height: altura, margin: '0 auto' }}>
        <iframe title={titulo} sandbox="" srcDoc={html} style={{
          width: 794, height: altura / Math.max(escala, 0.1),
          transform: `scale(${escala})`, transformOrigin: 'top left', margin: 0,
        }} />
      </div>
    </div>
  </div>;
  return ampliada ? createPortal(visualizador, document.body) : visualizador;
}
