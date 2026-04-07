import { useEffect, useMemo, useRef, useState } from "react";

// ============================================================================
// REGRAS DE NEGÓCIO E LÓGICA
// ============================================================================
const GRID = 5;
const SCALE = 1.8;
const THICKNESS = 15 * SCALE;
const SNAP_DISTANCE = 18;
const AVAILABLE_PIECES = [20, 25, 50, 70, 100, 120, 130, 150, 170, 200, 250, 270, 300];
const AUTOSAVE_KEY = "q15_builder_autosave_v1";

const PREFERRED_PIECES = [300, 270, 250, 200, 170, 150];

function snapToGrid(value) { return Math.round(value / GRID) * GRID; }
function rangesOverlap(aStart, aEnd, bStart, bEnd, tolerance = 20) { return aStart < bEnd + tolerance && aEnd > bStart - tolerance; }

function getPieceSize(type, rotation) {
  if (type === "cube") return { width: 15 * SCALE, height: 15 * SCALE };
  const length = Number(type) * SCALE;
  const isVertical = rotation === 90 || rotation === 270;
  return isVertical ? { width: THICKNESS, height: length } : { width: length, height: THICKNESS };
}

function getBounds(piece, x = piece.x, y = piece.y) {
  const { width, height } = getPieceSize(piece.type, piece.rotation);
  return { x, y, width, height, left: x, right: x + width, top: y, bottom: y + height };
}

function normalizeRect(rect) {
  const left = Math.min(rect.x1, rect.x2), right = Math.max(rect.x1, rect.x2);
  const top = Math.min(rect.y1, rect.y2), bottom = Math.max(rect.y1, rect.y2);
  return { left, right, top, bottom, width: right - left, height: bottom - top };
}

function boundsIntersect(a, b) { return !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom); }

function getSelectionBounds(pieces, ids) {
  const selected = pieces.filter((piece) => ids.includes(piece.id));
  if (!selected.length) return null;
  const boundsList = selected.map((piece) => getBounds(piece));
  return {
    left: Math.min(...boundsList.map((b) => b.left)), right: Math.max(...boundsList.map((b) => b.right)),
    top: Math.min(...boundsList.map((b) => b.top)), bottom: Math.max(...boundsList.map((b) => b.bottom)),
  };
}

function countPiecesForSelection(pieces, ids) {
  const counts = {};
  pieces.filter((piece) => ids.includes(piece.id)).forEach((piece) => { counts[piece.type] = (counts[piece.type] || 0) + 1; });
  return counts;
}

function createProjectPayload({ id, name, pieces, zoom }) {
  return { app: "q15-builder", version: 1, exportedAt: new Date().toISOString(), project: { id: id || Date.now().toString(), name: name || "Novo projeto", pieces, zoom, updatedAt: new Date().toISOString() } };
}

function readAutosave() { try { const raw = localStorage.getItem(AUTOSAVE_KEY); return raw ? JSON.parse(raw) : null; } catch { return null; } }
function writeAutosave(project) { localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(project)); }
function normalizeMeasure(value) { const numeric = Number(value); if (!Number.isFinite(numeric) || numeric <= 0) return 0; return Math.round(numeric / 5) * 5; }

function getPreferredWeight(piece) {
  if (piece === 300) return 100; if (piece === 270) return 95; if (piece === 250) return 90;
  if (piece === 200) return 85; if (piece === 170) return 80; if (piece === 150) return 75; return 1;
}

function getCombinationMetrics(combo) {
  const preferredCount = combo.filter((p) => PREFERRED_PIECES.includes(p)).length;
  const preferredWeightSum = combo.reduce((sum, p) => sum + (PREFERRED_PIECES.includes(p) ? getPreferredWeight(p) : 0), 0);
  const totalWeightSum = combo.reduce((sum, p) => sum + getPreferredWeight(p), 0);
  const nonPreferredCount = combo.filter((p) => !PREFERRED_PIECES.includes(p)).length;
  return { preferredCount, preferredWeightSum, totalWeightSum, nonPreferredCount, totalPieces: combo.length };
}

function compareCombinationPreference(candidate, best) {
  if (!best) return -1;
  const c = getCombinationMetrics(candidate), b = getCombinationMetrics(best);
  if (c.preferredCount !== b.preferredCount) return b.preferredCount - c.preferredCount;
  if (c.preferredWeightSum !== b.preferredWeightSum) return b.preferredWeightSum - c.preferredWeightSum;
  if (c.nonPreferredCount !== b.nonPreferredCount) return c.nonPreferredCount - b.nonPreferredCount;
  if (c.totalPieces !== b.totalPieces) return c.totalPieces - b.totalPieces;
  if (c.totalWeightSum !== b.totalWeightSum) return b.totalWeightSum - c.totalWeightSum;
  const candidateSorted = [...candidate].sort((a, b) => getPreferredWeight(b) - getPreferredWeight(a) || b - a);
  const bestSorted = [...best].sort((a, b) => getPreferredWeight(b) - getPreferredWeight(a) || b - a);
  for (let i = 0; i < Math.max(candidateSorted.length, bestSorted.length); i += 1) {
    const candidateValue = candidateSorted[i] || 0, bestValue = bestSorted[i] || 0;
    const candidateScore = getPreferredWeight(candidateValue), bestScore = getPreferredWeight(bestValue);
    if (candidateScore !== bestScore) return bestScore - candidateScore;
    if (candidateValue !== bestValue) return bestValue - candidateValue;
  }
  return 0;
}

function getBestPieceCombination(target) {
  const normalizedTarget = normalizeMeasure(target); if (!normalizedTarget) return null;
  const memo = new Map();
  const pieceOrder = [...PREFERRED_PIECES, ...AVAILABLE_PIECES.filter((p) => !PREFERRED_PIECES.includes(p)).sort((a, b) => b - a)];
  function solve(remaining) {
    if (remaining === 0) return []; if (remaining < 0) return null; if (memo.has(remaining)) return memo.get(remaining);
    let best = null;
    for (const piece of pieceOrder) {
      if (piece > remaining) continue;
      const next = solve(remaining - piece); if (!next) continue;
      const candidate = [piece, ...next];
      if (!best || compareCombinationPreference(candidate, best) < 0) best = candidate;
    }
    memo.set(remaining, best); return best;
  }
  return solve(normalizedTarget);
}

function distributeValueInSteps(total, parts) {
  if (parts <= 0) return []; if (parts === 1) return [total];
  const base = Math.floor(total / parts / 5) * 5;
  const result = Array(parts).fill(base);
  let used = base * parts, remainder = total - used, index = 0;
  while (remainder > 0) { result[index] += 5; remainder -= 5; index = (index + 1) % parts; }
  return result;
}

function getBayCountForWidth(totalWidthCm) {
  const normalizedWidth = normalizeMeasure(totalWidthCm);
  if (!normalizedWidth || normalizedWidth < 30) return 1; if (normalizedWidth <= 500) return 1;
  let bayCount = normalizedWidth >= 600 ? 2 : 1;
  while ((normalizedWidth - 15) / bayCount > 500) bayCount += 1;
  while (bayCount > 2 && (normalizedWidth - 15) / bayCount < 400) {
    bayCount -= 1; if ((normalizedWidth - 15) / bayCount > 500) { bayCount += 1; break; }
  }
  return Math.max(1, bayCount);
}

function getHorizontalBayPlans(totalWidthCm) {
  const normalizedWidth = normalizeMeasure(totalWidthCm); if (!normalizedWidth || normalizedWidth < 30) return null;
  const bayCount = getBayCountForWidth(normalizedWidth), columnCount = bayCount + 1;
  const totalHorizontalMetal = normalizedWidth - columnCount * 15; if (totalHorizontalMetal <= 0) return null;
  const bayMetalLengths = distributeValueInSteps(totalHorizontalMetal, bayCount);
  const bayPlans = [];
  for (const metalLength of bayMetalLengths) {
    const plan = getBestPieceCombination(metalLength); if (!plan) return null; bayPlans.push({ metalLength, plan });
  }
  return { bayCount, columnCount, bayPlans };
}

function getNextAutoOrigin(pieces) {
  if (!pieces.length) return { x: 600, y: 300 };
  const bounds = pieces.map((piece) => getBounds(piece)), maxRight = Math.max(...bounds.map((b) => b.right));
  return { x: snapToGrid(maxRight + 220), y: 300 };
}

function applyMagneticSnap(rawX, rawY, movingPiece, pieces) {
  let snappedX = snapToGrid(rawX), snappedY = snapToGrid(rawY);
  const movingBounds = getBounds(movingPiece, snappedX, snappedY);
  let bestX = { distance: Infinity, value: snappedX }, bestY = { distance: Infinity, value: snappedY };

  for (const other of pieces) {
    if (other.id === movingPiece.id) continue;
    const otherBounds = getBounds(other);
    const verticalMatch = rangesOverlap(movingBounds.top, movingBounds.bottom, otherBounds.top, otherBounds.bottom, 25);
    const horizontalMatch = rangesOverlap(movingBounds.left, movingBounds.right, otherBounds.left, otherBounds.right, 25);

    if (verticalMatch) {
      const xCandidates = [otherBounds.left, otherBounds.right, otherBounds.left - movingBounds.width, otherBounds.right - movingBounds.width];
      for (const candidate of xCandidates) { const distance = Math.abs(snappedX - candidate); if (distance < bestX.distance && distance <= SNAP_DISTANCE) bestX = { distance, value: candidate }; }
    }
    if (horizontalMatch) {
      const yCandidates = [otherBounds.top, otherBounds.bottom, otherBounds.top - movingBounds.height, otherBounds.bottom - movingBounds.height];
      for (const candidate of yCandidates) { const distance = Math.abs(snappedY - candidate); if (distance < bestY.distance && distance <= SNAP_DISTANCE) bestY = { distance, value: candidate }; }
    }
  }
  if (bestX.distance !== Infinity) snappedX = bestX.value;
  if (bestY.distance !== Infinity) snappedY = bestY.value;
  return { x: snapToGrid(snappedX), y: snapToGrid(snappedY) };
}

// ============================================================================
// COMPONENTE PRINCIPAL
// ============================================================================
export default function App() {
  const boardRef = useRef(null);
  const fileInputRef = useRef(null);

  const [pieces, setPieces] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [selectedBoxIds, setSelectedBoxIds] = useState([]);
  const [zoom, setZoom] = useState(1);
  const [projectName, setProjectName] = useState("Novo projeto");
  const [currentProjectId, setCurrentProjectId] = useState(null);
  const [selectionRect, setSelectionRect] = useState(null);
  const [autoWidth, setAutoWidth] = useState("");
  const [autoHeight, setAutoHeight] = useState("");

  // Refs de Mouse Clássico
  const isSpacePressedRef = useRef(false);
  const isPanningRef = useRef(false);
  const panStartRef = useRef({ x: 0, y: 0, left: 0, top: 0 });

  // Refs de Touch Screen Nativo (Pinça e Arraste)
  const isTouchPanningRef = useRef(false);
  const pinchStartDistRef = useRef(0);
  const pinchStartZoomRef = useRef(1);

  // ============================================================================
  // MOTOR DE HISTÓRICO (CTRL + Z)
  // ============================================================================
  const historyRef = useRef([]);

  const pushHistory = (currentPieces) => {
    if (historyRef.current.length > 50) historyRef.current.shift();
    historyRef.current.push(currentPieces.map(p => ({ ...p })));
  };

  const undo = () => {
    if (historyRef.current.length === 0) return;
    const previousState = historyRef.current.pop();
    setPieces(previousState);
    setSelectedId(null);
    setSelectedBoxIds([]);
  };

  // ============================================================================
  // FUNÇÕES DE COMANDO (DUPLICAR, GIRAR E APAGAR RÁPIDO)
  // ============================================================================
  const duplicateSelected = () => {
    if (!selectedId) return;
    pushHistory(pieces);
    const pieceToCopy = pieces.find(p => p.id === selectedId);
    if (!pieceToCopy) return;

    const newPiece = {
      ...pieceToCopy,
      id: Date.now() + Math.random(),
      x: snapToGrid(pieceToCopy.x + 40),
      y: snapToGrid(pieceToCopy.y + 40)
    };
    setPieces(prev => [...prev, newPiece]);
    setSelectedId(newPiece.id); 
  };

  const changeSelectedSize = (newType) => {
    if (!selectedId) return;
    pushHistory(pieces);
    updatePiece(selectedId, { type: newType });
  };

  const rotateSelected = () => {
    if (!selectedId) return;
    pushHistory(pieces);
    const p = pieces.find(p => p.id === selectedId);
    updatePiece(selectedId, { rotation: (p.rotation + 90) % 360 });
  };

  const removeSelected = () => {
    if (!selectedId) return;
    pushHistory(pieces);
    setPieces(prev => prev.filter(p => p.id !== selectedId));
    setSelectedId(null);
  };

  useEffect(() => {
    const autosave = readAutosave();
    if (autosave?.project) {
      setPieces(autosave.project.pieces || []); setZoom(autosave.project.zoom || 1);
      setProjectName(autosave.project.name || "Novo projeto"); setCurrentProjectId(autosave.project.id || null);
    }
  }, []);

  const currentProject = useMemo(() => createProjectPayload({ id: currentProjectId, name: projectName, pieces, zoom }), [currentProjectId, projectName, pieces, zoom]);
  useEffect(() => { writeAutosave(currentProject); }, [currentProject]);

  const counts = useMemo(() => {
    const acc = {}; pieces.forEach((piece) => { acc[piece.type] = (acc[piece.type] || 0) + 1; }); return acc;
  }, [pieces]);

  const selectedBoxBounds = useMemo(() => getSelectionBounds(pieces, selectedBoxIds), [pieces, selectedBoxIds]);
  const selectedBoxCounts = useMemo(() => countPiecesForSelection(pieces, selectedBoxIds), [pieces, selectedBoxIds]);

  function handleGenerateAutomaticBox() {
    const widthCm = normalizeMeasure(autoWidth); const heightCm = normalizeMeasure(autoHeight);
    if (!widthCm || !heightCm) return alert("Preencha largura e altura válidas em cm.");
    if (widthCm < 30 || heightCm < 30) return alert("A medida mínima externa do box deve ser 30 cm.");
    
    pushHistory(pieces);

    const cubeCm = 15; const cubePx = cubeCm * SCALE;
    const verticalMetalCm = heightCm - 30; const columnPiecesPlan = getBestPieceCombination(verticalMetalCm);
    if (!columnPiecesPlan) return alert("Não foi possível montar essa altura.");
    const horizontalPlan = getHorizontalBayPlans(widthCm);
    if (!horizontalPlan) return alert("Não foi possível montar essa largura.");

    const origin = getNextAutoOrigin(pieces);
    const createdPieces = []; const createdIds = [];
    const makePiece = (type, x, y, rotation = 0) => {
      const newPiece = { id: Date.now() + Math.random() + createdPieces.length, type: String(type), x: snapToGrid(x), y: snapToGrid(y), rotation };
      createdPieces.push(newPiece); createdIds.push(newPiece.id); return newPiece;
    };

    const topY = origin.y; const bottomY = origin.y + (heightCm - cubeCm) * SCALE;
    const columnXPositions = [origin.x]; let runningColumnX = origin.x;
    horizontalPlan.bayPlans.forEach((bay) => { runningColumnX += (bay.metalLength + cubeCm) * SCALE; columnXPositions.push(snapToGrid(runningColumnX)); });
    columnXPositions[columnXPositions.length - 1] = snapToGrid(origin.x + (widthCm - cubeCm) * SCALE);

    columnXPositions.forEach((cubeX) => { makePiece("cube", cubeX, topY, 0); makePiece("cube", cubeX, bottomY, 0); });
    columnXPositions.forEach((cubeX) => {
      let currentY = topY + cubePx;
      columnPiecesPlan.forEach((size) => { makePiece(String(size), cubeX, currentY, 90); currentY += size * SCALE; });
    });
    horizontalPlan.bayPlans.forEach((bay, index) => {
      const startX = columnXPositions[index] + cubePx;
      let runningTopX = startX; bay.plan.forEach((size) => { makePiece(String(size), runningTopX, topY, 0); runningTopX += size * SCALE; });
      let runningBottomX = startX; bay.plan.forEach((size) => { makePiece(String(size), runningBottomX, bottomY, 0); runningBottomX += size * SCALE; });
    });

    setPieces((prev) => [...prev, ...createdPieces]); setSelectedId(null); setSelectedBoxIds(createdIds); setSelectionRect(null);
  }

  function addPiece(type) { 
    pushHistory(pieces); 
    const newPiece = { id: Date.now() + Math.random(), type, x: 160, y: 160, rotation: 0 }; 
    setPieces((prev) => [...prev, newPiece]); 
    setSelectedId(newPiece.id); 
    setSelectedBoxIds([]); 
  }
  
  function updatePiece(id, newProps) { 
    setPieces((prev) => prev.map((piece) => (piece.id === id ? { ...piece, ...newProps } : piece))); 
  }
  
  function deletePiece(id) { 
    pushHistory(pieces); 
    setPieces((prev) => prev.filter((piece) => piece.id !== id)); 
    setSelectedId((prev) => (prev === id ? null : prev)); 
    setSelectedBoxIds((prev) => prev.filter((pieceId) => pieceId !== id)); 
  }
  
  function goToOrigin() { if (boardRef.current) boardRef.current.scrollTo({ left: 0, top: 0, behavior: "smooth" }); }
  
  function handleNewProject() { 
    pushHistory(pieces); 
    const id = Date.now().toString(); setPieces([]); setZoom(1); setSelectedId(null); setSelectedBoxIds([]); setSelectionRect(null); setProjectName("Novo projeto"); setCurrentProjectId(id); writeAutosave(createProjectPayload({ id, name: "Novo projeto", pieces: [], zoom: 1 })); 
  }
  
  function handleExportProject() {
    const payload = createProjectPayload({ id: currentProjectId, name: projectName, pieces, zoom });
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }); const url = URL.createObjectURL(blob); const link = document.createElement("a");
    const safeName = (projectName || "projeto-q15").trim().toLowerCase().replace(/[^a-z0-9-_]+/gi, "-");
    link.href = url; link.download = `${safeName}.q15.json`; document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
  }
  
  function handleImportClick() { fileInputRef.current?.click(); }
  function handleImportFile(event) {
    const file = event.target.files?.[0]; if (!file) return; const reader = new FileReader();
    reader.onload = () => { try { const parsed = JSON.parse(reader.result); const project = parsed?.project || parsed; if (!project || !Array.isArray(project.pieces)) return alert("Arquivo inválido."); pushHistory(pieces); setPieces(project.pieces || []); setZoom(project.zoom || 1); setSelectedId(null); setSelectedBoxIds([]); setSelectionRect(null); setProjectName(project.name || "Projeto importado"); setCurrentProjectId(project.id || Date.now().toString()); } catch { alert("Erro ao importar."); } finally { event.target.value = ""; } };
    reader.readAsText(file);
  }

  function handlePrintSelectedBox() {
    if (!selectedBoxIds.length || !selectedBoxBounds) {
      alert("Selecione um box arrastando o mouse ao redor dele antes de imprimir.");
      return;
    }
    const selectedPieces = pieces.filter((piece) => selectedBoxIds.includes(piece.id));
    const bounds = selectedBoxBounds;
    const drawingPadding = 30;
    const contentWidth = Math.max(1, bounds.right - bounds.left);
    const contentHeight = Math.max(1, bounds.bottom - bounds.top);
    const svgWidth = contentWidth + drawingPadding * 2;
    const svgHeight = contentHeight + drawingPadding * 2;
    const targetPreviewWidth = 980;
    const targetPreviewHeight = 430;
    const previewScale = Math.min(targetPreviewWidth / svgWidth, targetPreviewHeight / svgHeight);
    const fontCompensation = previewScale < 1 ? Math.min(3.6, 1 / previewScale) : 1;
    function esc(text) { return String(text).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;"); }
    
    const svgElements = selectedPieces.map((piece) => {
      const size = getPieceSize(piece.type, piece.rotation);
      const x = piece.x - bounds.left + drawingPadding;
      const y = piece.y - bounds.top + drawingPadding;
      const isCube = piece.type === "cube";
      const isVertical = piece.rotation === 90 || piece.rotation === 270;
      if (isCube) {
        const cubeFont = Math.max(12, Math.min(26, 12 * fontCompensation));
        return `<g><rect x="${x}" y="${y}" width="${size.width}" height="${size.height}" fill="#ffffff" stroke="#111827" stroke-width="2" /><text x="${x + size.width / 2}" y="${y + size.height / 2}" font-size="${cubeFont}" font-weight="700" fill="#111827" text-anchor="middle" dominant-baseline="middle">15</text></g>`;
      }
      const fontSize = isVertical ? Math.max(14, Math.min(30, 16 * fontCompensation)) : Math.max(14, Math.min(34, 18 * fontCompensation));
      if (isVertical) {
        return `<g><rect x="${x}" y="${y}" width="${size.width}" height="${size.height}" fill="#ffffff" stroke="#111827" stroke-width="1.6" /><text x="${x + size.width / 2}" y="${y + size.height / 2}" font-size="${fontSize}" font-weight="700" fill="#111827" text-anchor="middle" dominant-baseline="middle" transform="rotate(90 ${x + size.width / 2} ${y + size.height / 2})">${esc(piece.type)}</text></g>`;
      }
      return `<g><rect x="${x}" y="${y}" width="${size.width}" height="${size.height}" fill="#ffffff" stroke="#111827" stroke-width="1.6" /><text x="${x + size.width / 2}" y="${y + size.height / 2}" font-size="${fontSize}" font-weight="700" fill="#111827" text-anchor="middle" dominant-baseline="middle">${esc(piece.type)}</text></g>`;
    }).join("");
    const svgMarkup = `<svg viewBox="0 0 ${svgWidth} ${svgHeight}" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet" style="width:100%;height:100%;display:block;background:#fff;">${svgElements}</svg>`;
    const usedSummaryEntries = [...AVAILABLE_PIECES.filter((size) => (selectedBoxCounts[String(size)] || 0) > 0).map((size) => ({ label: `Peça ${size}`, value: selectedBoxCounts[String(size)] })), ...(selectedBoxCounts.cube > 0 ? [{ label: "Cubo", value: selectedBoxCounts.cube }] : []),];
    const summaryRows = usedSummaryEntries.map((item) => `<div class="summary-item"><span>${item.label}</span><strong>${item.value}</strong></div>`).join("");
    const printWindow = window.open("", "_blank", "width=1300,height=900");
    if (!printWindow) return;
    printWindow.document.write(`<html><head><title>Impressão do Box - Go Print</title><style>@page { size: A4 landscape; margin: 8mm; } * { box-sizing: border-box; } html, body { margin: 0; padding: 0; background: #ffffff; color: #111827; font-family: Arial, sans-serif; } .page { width: 100%; display: flex; flex-direction: column; gap: 10px; } .header { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; border-bottom: 2px solid #e2e8f0; padding-bottom: 10px; } .title { font-size: 20px; font-weight: 700; margin: 0; } .subtitle { margin-top: 3px; font-size: 11px; color: #475569; } .drawing-area { width: 100%; height: 130mm; border: 1px solid #cbd5e1; border-radius: 10px; background: #ffffff; padding: 8px; display: flex; align-items: center; justify-content: center; overflow: hidden; } .drawing-frame { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; } .drawing-svg { width: 100%; height: 100%; } .summary-wrap { border: 1px solid #cbd5e1; border-radius: 10px; padding: 8px 10px; background: #fff; } .summary-title { font-size: 13px; font-weight: 700; margin: 0 0 8px 0; } .summary-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px 14px; } .summary-item { display: flex; justify-content: space-between; gap: 10px; border-bottom: 1px dashed #cbd5e1; padding-bottom: 3px; font-size: 12px; } .summary-item strong { font-size: 12px; } @media print { .page { break-inside: avoid; } }</style></head><body><div class="page"><div class="header"><div><h1 class="title">${esc(projectName || "Projeto Q15")}</h1><div class="subtitle">Sistema de Box da Go Print - Desenho Técnico</div></div></div><div class="drawing-area"><div class="drawing-frame"><div class="drawing-svg">${svgMarkup}</div></div></div><div class="summary-wrap"><h2 class="summary-title">Resumo de peças do Box</h2><div class="summary-grid">${summaryRows || '<div class="summary-item"><span>Nenhuma peça</span><strong>0</strong></div>'}</div></div></div><script>window.onload = () => { setTimeout(() => window.print(), 250); };</script></body></html>`);
    printWindow.document.close();
  }

  // MOUSE: Arraste em grupo
  function startGroupMove(clientX, clientY) {
    const board = boardRef.current; if (!board || !selectedBoxIds.length) return;
    pushHistory(pieces);
    const rect = board.getBoundingClientRect(); 
    const startX = (clientX - rect.left + board.scrollLeft) / zoom; 
    const startY = (clientY - rect.top + board.scrollTop) / zoom;
    const original = pieces.map((p) => ({ id: p.id, x: p.x, y: p.y }));
    
    function handleMove(ev) {
      const currentX = (ev.clientX - rect.left + board.scrollLeft) / zoom; 
      const currentY = (ev.clientY - rect.top + board.scrollTop) / zoom;
      const dx = snapToGrid(currentX - startX), dy = snapToGrid(currentY - startY);
      setPieces((prev) => prev.map((p) => { if (!selectedBoxIds.includes(p.id)) return p; const base = original.find((o) => o.id === p.id); return { ...p, x: base.x + dx, y: base.y + dy }; }));
    }
    function handleUp() { window.removeEventListener("mousemove", handleMove); window.removeEventListener("mouseup", handleUp); }
    window.addEventListener("mousemove", handleMove); window.addEventListener("mouseup", handleUp);
  }

  // TOUCH: Arraste em grupo no celular
  function startGroupTouchMove(touchEvent) {
    const board = boardRef.current; if (!board || !selectedBoxIds.length) return;
    pushHistory(pieces);
    const rect = board.getBoundingClientRect(); 
    const startX = (touchEvent.clientX - rect.left + board.scrollLeft) / zoom; 
    const startY = (touchEvent.clientY - rect.top + board.scrollTop) / zoom;
    const original = pieces.map((p) => ({ id: p.id, x: p.x, y: p.y }));
    
    function handleTouchMove(ev) {
      const t = ev.touches[0];
      const currentX = (t.clientX - rect.left + board.scrollLeft) / zoom; 
      const currentY = (t.clientY - rect.top + board.scrollTop) / zoom;
      const dx = snapToGrid(currentX - startX), dy = snapToGrid(currentY - startY);
      setPieces((prev) => prev.map((p) => { if (!selectedBoxIds.includes(p.id)) return p; const base = original.find((o) => o.id === p.id); return { ...p, x: base.x + dx, y: base.y + dy }; }));
    }
    function handleTouchEnd() { window.removeEventListener("touchmove", handleTouchMove); window.removeEventListener("touchend", handleTouchEnd); }
    window.addEventListener("touchmove", handleTouchMove, { passive: false }); window.addEventListener("touchend", handleTouchEnd);
  }

  useEffect(() => {
    function handleKeyDown(e) { 
      if (e.code === "Space") { e.preventDefault(); isSpacePressedRef.current = true; } 
      if (e.key === "Delete" && selectedId) { e.preventDefault(); deletePiece(selectedId); } 
      if ((e.ctrlKey || e.metaKey || e.altKey) && e.key.toLowerCase() === "p") { e.preventDefault(); handlePrintSelectedBox(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); undo(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d" && selectedId) { e.preventDefault(); duplicateSelected(); }
    }
    function handleKeyUp(e) { if (e.code === "Space") { isSpacePressedRef.current = false; isPanningRef.current = false; } }
    window.addEventListener("keydown", handleKeyDown); window.addEventListener("keyup", handleKeyUp); return () => { window.removeEventListener("keydown", handleKeyDown); window.removeEventListener("keyup", handleKeyUp); };
  }, [selectedId, pieces, selectedBoxIds]); 

  // ============================================================================
  // EVENTOS DO MOUSE (COMPUTADOR)
  // ============================================================================
  useEffect(() => {
    const board = boardRef.current; if (!board) return;
    function handleWheel(e) {
      if (!e.altKey) return; e.preventDefault();
      const rect = board.getBoundingClientRect(); const pointerX = e.clientX - rect.left; const pointerY = e.clientY - rect.top;
      setZoom((current) => {
        const next = e.deltaY < 0 ? current + 0.08 : current - 0.08; const clamped = Math.min(2, Math.max(0.08, Number(next.toFixed(2))));
        const worldX = (board.scrollLeft + pointerX) / current; const worldY = (board.scrollTop + pointerY) / current;
        requestAnimationFrame(() => { board.scrollLeft = worldX * clamped - pointerX; board.scrollTop = worldY * clamped - pointerY; }); return clamped;
      });
    }
    board.addEventListener("wheel", handleWheel, { passive: false }); return () => board.removeEventListener("wheel", handleWheel);
  }, []);

  function handleBoardMouseDown(e) {
    if (!boardRef.current) return; const board = boardRef.current;
    if (e.target.closest('.context-menu')) return; // Protege o menu flutuante

    if (isSpacePressedRef.current) {
      e.preventDefault(); isPanningRef.current = true; panStartRef.current = { x: e.clientX, y: e.clientY, left: board.scrollLeft, top: board.scrollTop };
      function handleMouseMove(ev) { if (!isPanningRef.current || !boardRef.current) return; const dx = ev.clientX - panStartRef.current.x; const dy = ev.clientY - panStartRef.current.y; boardRef.current.scrollLeft = panStartRef.current.left - dx; boardRef.current.scrollTop = panStartRef.current.top - dy; }
      function handleMouseUp() { isPanningRef.current = false; window.removeEventListener("mousemove", handleMouseMove); window.removeEventListener("mouseup", handleMouseUp); }
      window.addEventListener("mousemove", handleMouseMove); window.addEventListener("mouseup", handleMouseUp); return;
    }
    const rect = board.getBoundingClientRect(); const startX = (e.clientX - rect.left + board.scrollLeft) / zoom; const startY = (e.clientY - rect.top + board.scrollTop) / zoom;
    setSelectedId(null); setSelectedBoxIds([]); setSelectionRect({ x1: startX, y1: startY, x2: startX, y2: startY });
    function handleMouseMove(ev) { const currentX = (ev.clientX - rect.left + board.scrollLeft) / zoom; const currentY = (ev.clientY - rect.top + board.scrollTop) / zoom; setSelectionRect({ x1: startX, y1: startY, x2: currentX, y2: currentY }); }
    function handleMouseUp(ev) {
      const endX = (ev.clientX - rect.left + board.scrollLeft) / zoom; const endY = (ev.clientY - rect.top + board.scrollTop) / zoom; const normalized = normalizeRect({ x1: startX, y1: startY, x2: endX, y2: endY });
      if (normalized.width > 8 || normalized.height > 8) setSelectedBoxIds(pieces.filter((piece) => boundsIntersect(getBounds(piece), normalized)).map((piece) => piece.id));
      setSelectionRect(null); window.removeEventListener("mousemove", handleMouseMove); window.removeEventListener("mouseup", handleMouseUp);
    }
    window.addEventListener("mousemove", handleMouseMove); window.addEventListener("mouseup", handleMouseUp);
  }

  // ============================================================================
  // EVENTOS TOUCH NATIVO (CELULAR E TABLET)
  // ============================================================================
  function handleBoardTouchStart(e) {
    if (!boardRef.current) return;
    if (e.target.closest('.context-menu')) return; // Protege o menu flutuante no touch
    
    if (e.touches.length === 2) {
      // Setup: PINÇA PARA ZOOM
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      pinchStartDistRef.current = Math.hypot(dx, dy);
      pinchStartZoomRef.current = zoom;
    } else if (e.touches.length === 1) {
      // Setup: ARRASTAR A TELA COM 1 DEDO
      isTouchPanningRef.current = true;
      panStartRef.current = {
        x: e.touches[0].clientX,
        y: e.touches[0].clientY,
        left: boardRef.current.scrollLeft,
        top: boardRef.current.scrollTop
      };
      // Limpa seleções se clicou no fundo
      setSelectedId(null);
      setSelectedBoxIds([]);
    }
  }

  function handleBoardTouchMove(e) {
    if (!boardRef.current) return;
    
    if (e.touches.length === 2) {
      // Executa: PINÇA PARA ZOOM
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      const scale = dist / pinchStartDistRef.current;
      let newZoom = pinchStartZoomRef.current * scale;
      newZoom = Math.min(2, Math.max(0.08, newZoom)); // Limita o zoom
      setZoom(newZoom);
    } else if (e.touches.length === 1 && isTouchPanningRef.current) {
      // Executa: ARRASTAR A TELA COM 1 DEDO
      const dx = e.touches[0].clientX - panStartRef.current.x;
      const dy = e.touches[0].clientY - panStartRef.current.y;
      boardRef.current.scrollLeft = panStartRef.current.left - dx;
      boardRef.current.scrollTop = panStartRef.current.top - dy;
    }
  }

  function handleBoardTouchEnd() {
    isTouchPanningRef.current = false;
  }


  // ============================================================================
  // RENDERIZAÇÃO BLINDADA E RESPONSIVA
  // ============================================================================
  return (
    <>
      <style>{`
        .q15-app-wrapper * { box-sizing: border-box; font-family: 'Inter', -apple-system, sans-serif; }
        .q15-app-wrapper { position: fixed; top: 0; left: 0; right: 0; bottom: 0; width: 100vw; height: 100vh; display: flex; flex-direction: column; overflow: hidden; background-color: #f1f5f9; z-index: 9999; }
        .q15-topbar { height: 60px; flex-shrink: 0; background: #0f172a; color: #ffffff; display: flex; align-items: center; justify-content: space-between; padding: 0 24px; z-index: 10; box-shadow: 0 1px 3px rgba(0,0,0,0.2); }
        .q15-main-body { display: flex; flex: 1; overflow: hidden; }
        .q15-sidebar { width: 300px; flex-shrink: 0; background: #ffffff; border-right: 1px solid #e2e8f0; padding: 20px; overflow-y: auto; display: flex; flex-direction: column; }
        .q15-canvas-container { flex: 1; position: relative; background: #f8fafc; overflow: hidden; }
        
        /* CSS VITAL PARA O MOBILE: Trava o zoom nativo do navegador para o nosso touch-action funcionar solto */
        .q15-canvas-scroller { width: 100%; height: 100%; overflow: auto; touch-action: none; }
        
        .q15-footer { height: 80px; flex-shrink: 0; background: #ffffff; border-top: 1px solid #e2e8f0; display: flex; align-items: center; padding: 0 24px; overflow-x: auto; box-shadow: 0 -1px 3px rgba(0,0,0,0.05); }
        .q15-input { padding: 10px; border: 1px solid #cbd5e1; border-radius: 6px; width: 100%; outline: none; font-size: 14px; color: #0f172a; background: #ffffff; }
        .q15-btn { padding: 10px 14px; border-radius: 6px; border: 1px solid #cbd5e1; background: #ffffff; color: #1e293b; cursor: pointer; font-weight: 600; font-size: 13px; transition: background 0.2s; }
        .q15-btn:hover { background: #f1f5f9; }
        .q15-btn-primary { background: #2563eb; color: #ffffff; border: none; }
        .q15-btn-primary:hover { background: #1d4ed8; }
        .q15-btn-print { background: #10b981; color: #ffffff; border: none; animation: pulse 2s infinite; }
        .q15-btn-print:hover { background: #059669; animation: none; }
        @keyframes pulse { 0% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.4); } 70% { box-shadow: 0 0 0 6px rgba(16, 185, 129, 0); } 100% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0); } }
        
        /* Menu Flutuante Premium - Agora Otimizado para os dedos no Mobile */
        .context-menu {
          position: absolute;
          background: #0f172a;
          padding: 8px;
          border-radius: 12px;
          display: flex;
          gap: 6px;
          z-index: 100;
          box-shadow: 0 10px 30px rgba(0,0,0,0.35);
          transform: translate(-50%, -110%);
          border: 1px solid #334155;
          align-items: center;
        }
        .context-btn {
          background: #1e293b;
          color: white;
          border: 1px solid #334155;
          border-radius: 8px;
          padding: 8px 14px;
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
        }
        .context-btn.danger { color: #f87171; }
        .context-btn:hover { background: #2563eb; border-color: #2563eb; color: white; }
        .context-btn.danger:hover { background: #dc2626; border-color: #dc2626; color: white; }
        
        .context-select {
          background: #1e293b;
          color: white;
          border: 1px solid #334155;
          border-radius: 8px;
          padding: 8px 10px;
          font-size: 12px;
          font-weight: 600;
          outline: none;
          cursor: pointer;
        }

        /* Ajustes Responsivos para Celular */
        @media (max-width: 768px) { 
          .q15-main-body { flex-direction: column; } 
          .q15-sidebar { width: 100%; max-height: 180px; border-right: none; border-bottom: 1px solid #e2e8f0; }
          .q15-topbar { padding: 0 12px; overflow-x: auto; }
          .q15-topbar input { width: 140px !important; }
        }
      `}</style>

      <div className="q15-app-wrapper">
        
        {/* TOPO */}
        <header className="q15-topbar">
          <div style={{ fontWeight: 800, fontSize: "16px", letterSpacing: "1px", minWidth: "max-content", marginRight: "12px" }}>Go Print</div>
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            
            {selectedBoxIds.length > 0 && (
              <button className="q15-btn q15-btn-print" style={{ padding: "8px 12px" }} onClick={handlePrintSelectedBox}>
                🖨️ PDF
              </button>
            )}

            <button className="q15-btn" style={{ background: "transparent", color: "#ffffff", borderColor: "rgba(255,255,255,0.3)", padding: "8px 12px" }} onClick={undo} title="Atalho: Ctrl+Z">
              ↩ Desfazer
            </button>

            <input 
              value={projectName} 
              onChange={(e) => setProjectName(e.target.value)} 
              style={{ padding: "8px 12px", borderRadius: "6px", border: "1px solid rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.1)", color: "#ffffff", outline: "none", width: "160px" }} 
              placeholder="Nome do projeto"
            />
            <button className="q15-btn" style={{ background: "transparent", color: "#ffffff", borderColor: "rgba(255,255,255,0.3)", padding: "8px 12px" }} onClick={handleNewProject}>Novo</button>
            <input ref={fileInputRef} type="file" accept=".json,.q15.json" onChange={handleImportFile} style={{ display: "none" }} />
            <button className="q15-btn q15-btn-primary" style={{ padding: "8px 16px" }} onClick={handleExportProject}>Salvar</button>
          </div>
        </header>

        {/* ÁREA CENTRAL */}
        <div className="q15-main-body">
          
          {/* BARRA LATERAL (Diminuída no mobile para sobrar tela) */}
          <aside className="q15-sidebar">
            <div style={{ marginBottom: "20px" }}>
              <div style={{ fontSize: "11px", fontWeight: 700, color: "#64748b", letterSpacing: "0.5px", marginBottom: "8px", textTransform: "uppercase" }}>Gerar Box Auto</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "8px" }}>
                <input value={autoWidth} onChange={(e) => setAutoWidth(e.target.value)} className="q15-input" placeholder="Larg (cm)" />
                <input value={autoHeight} onChange={(e) => setAutoHeight(e.target.value)} className="q15-input" placeholder="Alt (cm)" />
              </div>
              <button className="q15-btn q15-btn-primary" style={{ width: "100%" }} onClick={handleGenerateAutomaticBox}>+ Gerar Box</button>
            </div>

            <div>
              <div style={{ fontSize: "11px", fontWeight: 700, color: "#64748b", letterSpacing: "0.5px", marginBottom: "8px", textTransform: "uppercase" }}>Peças Avulsas</div>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <button className="q15-btn" style={{ borderColor: "#2563eb", color: "#2563eb", fontWeight: 700, display: "flex", justifyContent: "space-between" }} onClick={() => addPiece("cube")}>
                  <span>Cubo de Canto (15cm)</span><span>+</span>
                </button>
                {AVAILABLE_PIECES.map((size) => (
                  <button key={size} className="q15-btn" style={{ display: "flex", justifyContent: "space-between" }} onClick={() => addPiece(String(size))}>
                    <span>Treliça Q15 - {size} cm</span><span style={{ color: "#94a3b8" }}>+</span>
                  </button>
                ))}
              </div>
            </div>
          </aside>

          {/* ÁREA DE DESENHO */}
          <main className="q15-canvas-container">
            {/* Controles Flutuantes de Zoom (Mais fáceis para tocar) */}
            <div style={{ position: "absolute", right: "16px", top: "16px", zIndex: 20, display: "flex", flexDirection: "column", gap: "8px" }}>
              <button className="q15-btn" style={{ padding: "8px", width: "42px", height: "42px", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 2px 8px rgba(0,0,0,0.15)", borderRadius: "50%", fontSize: "18px" }} onClick={() => setZoom((z) => Math.min(z + 0.1, 2))}>+</button>
              <button className="q15-btn" style={{ padding: "8px", width: "42px", height: "42px", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 2px 8px rgba(0,0,0,0.15)", borderRadius: "50%", fontSize: "18px" }} onClick={() => setZoom((z) => Math.max(z - 0.1, 0.08))}>-</button>
              <button className="q15-btn" style={{ padding: "8px", width: "42px", height: "42px", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 2px 8px rgba(0,0,0,0.15)", borderRadius: "50%", fontSize: "12px" }} onClick={goToOrigin}>Início</button>
            </div>

            {/* O SCROLL COM A EVENTOS TOUCH NATIVOS APLICADOS */}
            <div className="q15-canvas-scroller" ref={boardRef} 
                 onMouseDown={handleBoardMouseDown} 
                 onTouchStart={handleBoardTouchStart}
                 onTouchMove={handleBoardTouchMove}
                 onTouchEnd={handleBoardTouchEnd}
                 style={{ cursor: isSpacePressedRef.current ? (isPanningRef.current ? "grabbing" : "grab") : "crosshair" }}>
              
              <div style={{ width: 30000 * zoom, height: 8000 * zoom, position: "relative" }}>
                <div style={{
                  width: 30000, height: 8000, position: "relative", backgroundColor: "#ffffff",
                  backgroundImage: "linear-gradient(#e2e8f0 1px, transparent 1px), linear-gradient(90deg, #e2e8f0 1px, transparent 1px)",
                  backgroundSize: `${GRID * 2}px ${GRID * 2}px`,
                  transform: `scale(${zoom})`, transformOrigin: "top left",
                }}>
                  {selectionRect && (() => { const rect = normalizeRect(selectionRect); return <div style={{ position: "absolute", left: rect.left, top: rect.top, width: rect.width, height: rect.height, border: "2px dashed #2563eb", background: "rgba(37,99,235,0.08)", pointerEvents: "none", zIndex: 10 }} />; })()}
                  {selectedBoxBounds && <div style={{ position: "absolute", left: selectedBoxBounds.left - 8, top: selectedBoxBounds.top - 8, width: selectedBoxBounds.right - selectedBoxBounds.left + 16, height: selectedBoxBounds.bottom - selectedBoxBounds.top + 16, border: "2px solid #2563eb", background: "rgba(37,99,235,0.03)", pointerEvents: "none", zIndex: 9 }} />}
                  
                  {/* RENDERIZAÇÃO DAS PEÇAS COM EVENTOS TOUCH */}
                  {pieces.map((piece) => (
                    <Piece 
                      key={piece.id} 
                      piece={piece} 
                      pieces={pieces} 
                      boardRef={boardRef} 
                      updatePiece={updatePiece} 
                      deletePiece={deletePiece} 
                      zoom={zoom} 
                      selected={piece.id === selectedId} 
                      onSelect={() => setSelectedId(piece.id)} 
                      isSpacePressedRef={isSpacePressedRef} 
                      selectedBoxIds={selectedBoxIds} 
                      startGroupMove={startGroupMove} 
                      startGroupTouchMove={startGroupTouchMove}
                      pushHistory={pushHistory} 
                    />
                  ))}

                  {/* MENU FLUTUANTE DE CONTEXTO OTIMIZADO PARA MOBILE E DESKTOP */}
                  {selectedId && (() => {
                    const selPiece = pieces.find(p => p.id === selectedId);
                    if (!selPiece) return null;
                    const { width } = getPieceSize(selPiece.type, selPiece.rotation);
                    
                    return (
                      <div className="context-menu" style={{ left: selPiece.x + width / 2, top: selPiece.y }}>
                        <button className="context-btn" onClick={duplicateSelected} title="Ctrl+D">Duplicar</button>
                        <button className="context-btn" onClick={rotateSelected}>Girar</button>
                        <select className="context-select" value={selPiece.type} onChange={(e) => changeSelectedSize(e.target.value)}>
                          <option value="cube">Cubo 15</option>
                          {AVAILABLE_PIECES.map(size => (
                            <option key={size} value={String(size)}>Tr. {size}</option>
                          ))}
                        </select>
                        <button className="context-btn danger" onClick={removeSelected}>Excluir</button>
                      </div>
                    );
                  })()}

                </div>
              </div>
            </div>
          </main>
        </div>

        {/* RODAPÉ: LISTA DE MATERIAIS */}
        <footer className="q15-footer">
          <div style={{ fontSize: "12px", fontWeight: 700, color: "#475569", marginRight: "24px", letterSpacing: "0.5px" }}>MATERIAIS</div>
          
          <div style={{ display: "flex", gap: "8px" }}>
            <div style={{ border: "1px solid #e2e8f0", padding: "6px 12px", borderRadius: "6px", background: "#f8fafc", display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ fontSize: "11px", color: "#64748b" }}>Cubo 15cm</span>
              <span style={{ fontSize: "14px", fontWeight: 700, color: "#0f172a" }}>{counts.cube || 0}</span>
            </div>

            {AVAILABLE_PIECES.filter(size => counts[String(size)] > 0).map(size => (
              <div key={size} style={{ border: "1px solid #e2e8f0", padding: "6px 12px", borderRadius: "6px", background: "#f8fafc", display: "flex", alignItems: "center", gap: "8px" }}>
                <span style={{ fontSize: "11px", color: "#64748b" }}>Q15 {size}cm</span>
                <span style={{ fontSize: "14px", fontWeight: 700, color: "#0f172a" }}>{counts[String(size)]}</span>
              </div>
            ))}
          </div>
        </footer>

      </div>
    </>
  );
}

// ============================================================================
// COMPONENTE PEÇA 2D (AGORA COM CONTROLES NATIVOS DE TOUCH SCREEN)
// ============================================================================
function Piece({ piece, pieces, boardRef, updatePiece, deletePiece, selected, onSelect, zoom, isSpacePressedRef, selectedBoxIds, startGroupMove, startGroupTouchMove, pushHistory }) {
  const offsetRef = useRef({ x: 0, y: 0 });
  const { width, height } = getPieceSize(piece.type, piece.rotation);
  const isCube = piece.type === "cube";
  const isVertical = piece.rotation === 90 || piece.rotation === 270;

  // Evento Nativo Desktop (Mouse)
  function handleMouseDown(e) {
    if (isSpacePressedRef.current) return; e.preventDefault(); e.stopPropagation(); onSelect();
    pushHistory(pieces);

    if (selectedBoxIds.includes(piece.id)) { startGroupMove(e.clientX, e.clientY); return; }
    
    const board = boardRef.current; if (!board) return; const boardRect = board.getBoundingClientRect();
    offsetRef.current = { x: (e.clientX - boardRect.left + board.scrollLeft) / zoom - piece.x, y: (e.clientY - boardRect.top + board.scrollTop) / zoom - piece.y };
    function handleMouseMove(ev) { const rawX = (ev.clientX - boardRect.left + board.scrollLeft) / zoom - offsetRef.current.x; const rawY = (ev.clientY - boardRect.top + board.scrollTop) / zoom - offsetRef.current.y; const snapped = applyMagneticSnap(rawX, rawY, piece, pieces); updatePiece(piece.id, { x: snapped.x, y: snapped.y }); }
    function handleMouseUp() { window.removeEventListener("mousemove", handleMouseMove); window.removeEventListener("mouseup", handleMouseUp); }
    window.addEventListener("mousemove", handleMouseMove); window.addEventListener("mouseup", handleMouseUp);
  }

  // Evento Nativo Mobile (Touch)
  function handleTouchStart(e) {
    if (e.touches.length > 1) return; // Ignora se estiver fazendo pinça para zoom
    e.stopPropagation(); // Bloqueia o scroll do fundo da tela
    onSelect();
    pushHistory(pieces);

    if (selectedBoxIds.includes(piece.id)) { startGroupTouchMove(e.touches[0]); return; }

    const touch = e.touches[0];
    const board = boardRef.current; if (!board) return; const boardRect = board.getBoundingClientRect();
    offsetRef.current = { x: (touch.clientX - boardRect.left + board.scrollLeft) / zoom - piece.x, y: (touch.clientY - boardRect.top + board.scrollTop) / zoom - piece.y };
    
    function handleTouchMove(ev) { 
      const t = ev.touches[0];
      const rawX = (t.clientX - boardRect.left + board.scrollLeft) / zoom - offsetRef.current.x; 
      const rawY = (t.clientY - boardRect.top + board.scrollTop) / zoom - offsetRef.current.y; 
      const snapped = applyMagneticSnap(rawX, rawY, piece, pieces); 
      updatePiece(piece.id, { x: snapped.x, y: snapped.y }); 
    }
    function handleTouchEnd() { window.removeEventListener("touchmove", handleTouchMove); window.removeEventListener("touchend", handleTouchEnd); }
    window.addEventListener("touchmove", handleTouchMove, { passive: false }); window.addEventListener("touchend", handleTouchEnd);
  }

  // Double click clássico e Botão direito retidos para desktop
  function handleDoubleClick(e) { if (isSpacePressedRef.current) return; e.preventDefault(); e.stopPropagation(); onSelect(); pushHistory(pieces); updatePiece(piece.id, { rotation: (piece.rotation + 90) % 360 }); }
  function handleContextMenu(e) { e.preventDefault(); e.stopPropagation(); pushHistory(pieces); deletePiece(piece.id); }

  return (
    <div 
      onMouseDown={handleMouseDown} 
      onTouchStart={handleTouchStart}
      onDoubleClick={handleDoubleClick} 
      onContextMenu={handleContextMenu} 
      style={{ position: "absolute", left: piece.x, top: piece.y, width, height, cursor: isSpacePressedRef.current ? "grabbing" : "grab", userSelect: "none", zIndex: 20, touchAction: "none" /* TRAVA VITAL PRO MOBILE FUNCIONAR */ }}
    >
      {isCube ? (
        <div style={{ width: "100%", height: "100%", background: "#f8fafc", border: selected ? "3px solid #2563eb" : "2px solid #334155", boxSizing: "border-box", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: selected ? "0 0 0 4px rgba(37,99,235,0.2)" : "0 2px 4px rgba(0,0,0,0.1)" }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: "#334155" }}>15</span>
        </div>
      ) : (
        <div style={{ width: "100%", height: "100%", background: "#ffffff", border: selected ? "3px solid #2563eb" : "1px solid #334155", boxSizing: "border-box", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: selected ? "0 0 0 4px rgba(37,99,235,0.2)" : "0 2px 4px rgba(0,0,0,0.1)" }}>
          <span style={{ whiteSpace: "nowrap", transform: isVertical ? "rotate(90deg)" : "none", fontSize: isVertical ? 12 : 14, fontWeight: 700, color: "#334155" }}>{piece.type}</span>
        </div>
      )}
    </div>
  );
}