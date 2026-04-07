import { useEffect, useMemo, useRef, useState } from "react";

const GRID = 5;
const SCALE = 1.8;
const THICKNESS = 15 * SCALE;
const SNAP_DISTANCE = 18;
const AVAILABLE_PIECES = [20, 25, 50, 70, 100, 120, 130, 150, 170, 200, 250, 270, 300];

// peças com prioridade na montagem automática
const PREFERRED_PIECES = [300, 270, 250, 200, 170, 150];

function snapToGrid(value) {
  return Math.round(value / GRID) * GRID;
}

function rangesOverlap(aStart, aEnd, bStart, bEnd, tolerance = 20) {
  return aStart < bEnd + tolerance && aEnd > bStart - tolerance;
}

function getPieceSize(type, rotation) {
  if (type === "cube") {
    const cubeSize = 15 * SCALE;
    return { width: cubeSize, height: cubeSize };
  }

  const length = Number(type) * SCALE;
  const isVertical = rotation === 90 || rotation === 270;

  return isVertical
    ? { width: THICKNESS, height: length }
    : { width: length, height: THICKNESS };
}

function getBounds(piece, x = piece.x, y = piece.y) {
  const { width, height } = getPieceSize(piece.type, piece.rotation);
  return {
    x,
    y,
    width,
    height,
    left: x,
    right: x + width,
    top: y,
    bottom: y + height,
  };
}

function normalizeRect(rect) {
  const left = Math.min(rect.x1, rect.x2);
  const right = Math.max(rect.x1, rect.x2);
  const top = Math.min(rect.y1, rect.y2);
  const bottom = Math.max(rect.y1, rect.y2);
  return {
    left,
    right,
    top,
    bottom,
    width: right - left,
    height: bottom - top,
  };
}

function boundsIntersect(a, b) {
  return !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom);
}

function getSelectionBounds(pieces, ids) {
  const selected = pieces.filter((piece) => ids.includes(piece.id));
  if (!selected.length) return null;

  const boundsList = selected.map((piece) => getBounds(piece));
  return {
    left: Math.min(...boundsList.map((b) => b.left)),
    right: Math.max(...boundsList.map((b) => b.right)),
    top: Math.min(...boundsList.map((b) => b.top)),
    bottom: Math.max(...boundsList.map((b) => b.bottom)),
  };
}

function countPiecesForSelection(pieces, ids) {
  const counts = {};
  pieces
    .filter((piece) => ids.includes(piece.id))
    .forEach((piece) => {
      counts[piece.type] = (counts[piece.type] || 0) + 1;
    });
  return counts;
}

function createProjectPayload({ id, name, pieces, zoom }) {
  return {
    app: "q15-builder",
    version: 1,
    exportedAt: new Date().toISOString(),
    project: {
      id: id || Date.now().toString(),
      name: name || "Novo projeto",
      pieces,
      zoom,
      updatedAt: new Date().toISOString(),
    },
  };
}

function normalizeMeasure(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return Math.round(numeric / 5) * 5;
}

function getPreferredWeight(piece) {
  if (piece === 300) return 100;
  if (piece === 270) return 95;
  if (piece === 250) return 90;
  if (piece === 200) return 85;
  if (piece === 170) return 80;
  if (piece === 150) return 75;
  return 1;
}

function getCombinationMetrics(combo) {
  const preferredCount = combo.filter((p) => PREFERRED_PIECES.includes(p)).length;
  const preferredWeightSum = combo.reduce(
    (sum, p) => sum + (PREFERRED_PIECES.includes(p) ? getPreferredWeight(p) : 0),
    0
  );
  const totalWeightSum = combo.reduce((sum, p) => sum + getPreferredWeight(p), 0);
  const nonPreferredCount = combo.filter((p) => !PREFERRED_PIECES.includes(p)).length;

  return {
    preferredCount,
    preferredWeightSum,
    totalWeightSum,
    nonPreferredCount,
    totalPieces: combo.length,
  };
}

function compareCombinationPreference(candidate, best) {
  if (!best) return -1;

  const c = getCombinationMetrics(candidate);
  const b = getCombinationMetrics(best);

  if (c.preferredCount !== b.preferredCount) {
    return b.preferredCount - c.preferredCount;
  }

  if (c.preferredWeightSum !== b.preferredWeightSum) {
    return b.preferredWeightSum - c.preferredWeightSum;
  }

  if (c.nonPreferredCount !== b.nonPreferredCount) {
    return c.nonPreferredCount - b.nonPreferredCount;
  }

  if (c.totalPieces !== b.totalPieces) {
    return c.totalPieces - b.totalPieces;
  }

  if (c.totalWeightSum !== b.totalWeightSum) {
    return b.totalWeightSum - c.totalWeightSum;
  }

  const candidateSorted = [...candidate].sort((a, b) => getPreferredWeight(b) - getPreferredWeight(a) || b - a);
  const bestSorted = [...best].sort((a, b) => getPreferredWeight(b) - getPreferredWeight(a) || b - a);

  for (let i = 0; i < Math.max(candidateSorted.length, bestSorted.length); i += 1) {
    const candidateValue = candidateSorted[i] || 0;
    const bestValue = bestSorted[i] || 0;

    const candidateScore = getPreferredWeight(candidateValue);
    const bestScore = getPreferredWeight(bestValue);

    if (candidateScore !== bestScore) {
      return bestScore - candidateScore;
    }

    if (candidateValue !== bestValue) {
      return bestValue - candidateValue;
    }
  }

  return 0;
}

function getBestPieceCombination(target) {
  const normalizedTarget = normalizeMeasure(target);
  if (!normalizedTarget) return null;

  const memo = new Map();

  const pieceOrder = [
    ...PREFERRED_PIECES,
    ...AVAILABLE_PIECES
      .filter((p) => !PREFERRED_PIECES.includes(p))
      .sort((a, b) => b - a),
  ];

  function solve(remaining) {
    if (remaining === 0) return [];
    if (remaining < 0) return null;
    if (memo.has(remaining)) return memo.get(remaining);

    let best = null;

    for (const piece of pieceOrder) {
      if (piece > remaining) continue;

      const next = solve(remaining - piece);
      if (!next) continue;

      const candidate = [piece, ...next];

      if (!best || compareCombinationPreference(candidate, best) < 0) {
        best = candidate;
      }
    }

    memo.set(remaining, best);
    return best;
  }

  return solve(normalizedTarget);
}

function distributeValueInSteps(total, parts) {
  if (parts <= 0) return [];
  if (parts === 1) return [total];

  const base = Math.floor(total / parts / 5) * 5;
  const result = Array(parts).fill(base);
  let used = base * parts;
  let remainder = total - used;

  let index = 0;
  while (remainder > 0) {
    result[index] += 5;
    remainder -= 5;
    index = (index + 1) % parts;
  }

  return result;
}

function getBayCountForWidth(totalWidthCm) {
  const normalizedWidth = normalizeMeasure(totalWidthCm);
  if (!normalizedWidth || normalizedWidth < 30) return 1;

  if (normalizedWidth <= 500) {
    return 1;
  }

  let bayCount = normalizedWidth >= 600 ? 2 : 1;

  while ((normalizedWidth - 15) / bayCount > 500) {
    bayCount += 1;
  }

  while (bayCount > 2 && (normalizedWidth - 15) / bayCount < 400) {
    bayCount -= 1;
    if ((normalizedWidth - 15) / bayCount > 500) {
      bayCount += 1;
      break;
    }
  }

  return Math.max(1, bayCount);
}

function getHorizontalBayPlans(totalWidthCm) {
  const normalizedWidth = normalizeMeasure(totalWidthCm);
  if (!normalizedWidth || normalizedWidth < 30) return null;

  const bayCount = getBayCountForWidth(normalizedWidth);
  const columnCount = bayCount + 1;

  const totalHorizontalMetal = normalizedWidth - columnCount * 15;
  if (totalHorizontalMetal <= 0) return null;

  const bayMetalLengths = distributeValueInSteps(totalHorizontalMetal, bayCount);
  const bayPlans = [];

  for (const metalLength of bayMetalLengths) {
    const plan = getBestPieceCombination(metalLength);
    if (!plan) return null;

    bayPlans.push({
      metalLength,
      plan,
    });
  }

  return {
    bayCount,
    columnCount,
    bayPlans,
  };
}

function getNextAutoOrigin(pieces) {
  if (!pieces.length) {
    return { x: 600, y: 300 };
  }

  const bounds = pieces.map((piece) => getBounds(piece));
  const maxRight = Math.max(...bounds.map((b) => b.right));
  return {
    x: snapToGrid(maxRight + 220),
    y: 300,
  };
}

function applyMagneticSnap(rawX, rawY, movingPiece, pieces) {
  let snappedX = snapToGrid(rawX);
  let snappedY = snapToGrid(rawY);

  const movingBounds = getBounds(movingPiece, snappedX, snappedY);
  let bestX = { distance: Infinity, value: snappedX };
  let bestY = { distance: Infinity, value: snappedY };

  for (const other of pieces) {
    if (other.id === movingPiece.id) continue;

    const otherBounds = getBounds(other);

    const verticalMatch = rangesOverlap(
      movingBounds.top,
      movingBounds.bottom,
      otherBounds.top,
      otherBounds.bottom,
      25
    );

    const horizontalMatch = rangesOverlap(
      movingBounds.left,
      movingBounds.right,
      otherBounds.left,
      otherBounds.right,
      25
    );

    if (verticalMatch) {
      const xCandidates = [
        otherBounds.left,
        otherBounds.right,
        otherBounds.left - movingBounds.width,
        otherBounds.right - movingBounds.width,
      ];

      for (const candidate of xCandidates) {
        const distance = Math.abs(snappedX - candidate);
        if (distance < bestX.distance && distance <= SNAP_DISTANCE) {
          bestX = { distance, value: candidate };
        }
      }
    }

    if (horizontalMatch) {
      const yCandidates = [
        otherBounds.top,
        otherBounds.bottom,
        otherBounds.top - movingBounds.height,
        otherBounds.bottom - movingBounds.height,
      ];

      for (const candidate of yCandidates) {
        const distance = Math.abs(snappedY - candidate);
        if (distance < bestY.distance && distance <= SNAP_DISTANCE) {
          bestY = { distance, value: candidate };
        }
      }
    }
  }

  if (bestX.distance !== Infinity) snappedX = bestX.value;
  if (bestY.distance !== Infinity) snappedY = bestY.value;

  return {
    x: snapToGrid(snappedX),
    y: snapToGrid(snappedY),
  };
}

function getViewportInfo() {
  if (typeof window === "undefined") {
    return { isMobile: false, isTablet: false, width: 1440 };
  }

  const width = window.innerWidth;
  return {
    width,
    isMobile: width <= 900,
    isTablet: width > 900 && width <= 1280,
  };
}

function getDistance(t1, t2) {
  const dx = t1.clientX - t2.clientX;
  const dy = t1.clientY - t2.clientY;
  return Math.sqrt(dx * dx + dy * dy);
}

function getMidpoint(t1, t2) {
  return {
    x: (t1.clientX + t2.clientX) / 2,
    y: (t1.clientY + t2.clientY) / 2,
  };
}

const palette = {
  bg: "#08101f",
  bg2: "#0d172b",
  panel: "rgba(15, 23, 42, 0.92)",
  panel2: "rgba(17, 26, 45, 0.96)",
  border: "#233455",
  borderSoft: "#2e446b",
  text: "#ffffff",
  textSoft: "#9fb0d1",
  primary: "#3b82f6",
  canvas: "#eef3fa",
};

const inputStyle = {
  width: "100%",
  boxSizing: "border-box",
  borderRadius: 12,
  border: `1px solid ${palette.borderSoft}`,
  background: "#0b1325",
  color: "#fff",
  padding: "12px 14px",
  outline: "none",
  fontSize: 14,
};

const buttonBase = {
  border: "1px solid transparent",
  borderRadius: 12,
  cursor: "pointer",
  fontWeight: 700,
};

const smallButtonStyle = {
  ...buttonBase,
  padding: "10px 12px",
  border: `1px solid ${palette.border}`,
  background: "#16213b",
  color: "#fff",
  fontSize: 12,
};

const sidebarButtonStyle = {
  ...buttonBase,
  padding: "12px 14px",
  textAlign: "left",
  borderRadius: 14,
  border: `1px solid ${palette.border}`,
  background: "#16213b",
  color: "#fff",
  fontWeight: 700,
};

const controlButtonStyle = {
  ...buttonBase,
  padding: "10px 14px",
  borderRadius: 12,
  border: `1px solid ${palette.border}`,
  background: "#0f172a",
  color: "#fff",
  fontWeight: 700,
};

function SectionCard({ title, subtitle, children }) {
  return (
    <div
      style={{
        marginBottom: 16,
        padding: 14,
        borderRadius: 18,
        background: palette.panel2,
        border: `1px solid ${palette.border}`,
        backdropFilter: "blur(10px)",
      }}
    >
      {(title || subtitle) && (
        <div style={{ marginBottom: 10 }}>
          {title && (
            <div style={{ fontSize: 14, fontWeight: 800, color: "#fff", marginBottom: subtitle ? 4 : 0 }}>
              {title}
            </div>
          )}
          {subtitle && (
            <div style={{ fontSize: 12, color: palette.textSoft, lineHeight: 1.5 }}>
              {subtitle}
            </div>
          )}
        </div>
      )}
      {children}
    </div>
  );
}

function SummaryLines({ counts }) {
  return (
    <div style={{ fontSize: 13, color: "#d7e1f7", lineHeight: 1.8 }}>
      {AVAILABLE_PIECES.map((size) => (
        <div key={size}>
          Peça {size}: <strong>{counts[String(size)] || 0}</strong>
        </div>
      ))}
      <div>
        Cubo: <strong>{counts.cube || 0}</strong>
      </div>
    </div>
  );
}

export default function App() {
  const boardRef = useRef(null);
  const fileInputRef = useRef(null);
  const pinchStateRef = useRef(null);
  const boardTouchRef = useRef({ mode: null, startX: 0, startY: 0, startLeft: 0, startTop: 0 });

  const [pieces, setPieces] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [selectedBoxIds, setSelectedBoxIds] = useState([]);
  const [zoom, setZoom] = useState(1);
  const [projectName, setProjectName] = useState("Novo projeto");
  const [currentProjectId, setCurrentProjectId] = useState(Date.now().toString());
  const [selectionRect, setSelectionRect] = useState(null);
  const [autoWidth, setAutoWidth] = useState("");
  const [autoHeight, setAutoHeight] = useState("");
  const [viewport, setViewport] = useState(getViewportInfo());
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const isSpacePressedRef = useRef(false);
  const isPanningRef = useRef(false);
  const panStartRef = useRef({ x: 0, y: 0, left: 0, top: 0 });

  const { isMobile, isTablet } = viewport;
  const sidebarWidth = isMobile ? Math.min(360, viewport.width * 0.88) : isTablet ? 320 : 360;
  const topBarHeight = isMobile ? 64 : 72;
  const bottomToolbarHeight = isMobile ? 82 : 0;

  useEffect(() => {
    function handleResize() {
      setViewport(getViewportInfo());
    }

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    if (!isMobile) {
      setSidebarOpen(false);
    }
  }, [isMobile]);

  const currentProject = useMemo(
    () =>
      createProjectPayload({
        id: currentProjectId,
        name: projectName,
        pieces,
        zoom,
      }),
    [currentProjectId, projectName, pieces, zoom]
  );

  const counts = useMemo(() => {
    const acc = {};
    pieces.forEach((piece) => {
      acc[piece.type] = (acc[piece.type] || 0) + 1;
    });
    return acc;
  }, [pieces]);

  const selectedBoxBounds = useMemo(
    () => getSelectionBounds(pieces, selectedBoxIds),
    [pieces, selectedBoxIds]
  );

  const selectedBoxCounts = useMemo(
    () => countPiecesForSelection(pieces, selectedBoxIds),
    [pieces, selectedBoxIds]
  );

  function handleGenerateAutomaticBox() {
    const widthCm = normalizeMeasure(autoWidth);
    const heightCm = normalizeMeasure(autoHeight);

    if (!widthCm || !heightCm) {
      alert("Preencha largura e altura válidas em cm.");
      return;
    }

    if (widthCm < 30 || heightCm < 30) {
      alert("A medida mínima externa do box deve ser 30 cm, por causa dos cubos.");
      return;
    }

    const cubeCm = 15;
    const cubePx = cubeCm * SCALE;

    const verticalMetalCm = heightCm - 30;
    const columnPiecesPlan = getBestPieceCombination(verticalMetalCm);

    if (!columnPiecesPlan) {
      alert("Não foi possível montar essa altura com as peças disponíveis.");
      return;
    }

    const horizontalPlan = getHorizontalBayPlans(widthCm);

    if (!horizontalPlan) {
      alert("Não foi possível montar essa largura com as peças disponíveis.");
      return;
    }

    const origin = getNextAutoOrigin(pieces);
    const createdPieces = [];
    const createdIds = [];

    const makePiece = (type, x, y, rotation = 0) => {
      const newPiece = {
        id: Date.now() + Math.random() + createdPieces.length,
        type: String(type),
        x: snapToGrid(x),
        y: snapToGrid(y),
        rotation,
      };
      createdPieces.push(newPiece);
      createdIds.push(newPiece.id);
      return newPiece;
    };

    const topY = origin.y;
    const bottomY = origin.y + (heightCm - cubeCm) * SCALE;

    const columnXPositions = [origin.x];
    let runningColumnX = origin.x;

    horizontalPlan.bayPlans.forEach((bay) => {
      runningColumnX += (bay.metalLength + cubeCm) * SCALE;
      columnXPositions.push(snapToGrid(runningColumnX));
    });

    const expectedLastX = origin.x + (widthCm - cubeCm) * SCALE;
    const lastIndex = columnXPositions.length - 1;
    columnXPositions[lastIndex] = snapToGrid(expectedLastX);

    columnXPositions.forEach((cubeX) => {
      makePiece("cube", cubeX, topY, 0);
      makePiece("cube", cubeX, bottomY, 0);
    });

    columnXPositions.forEach((cubeX) => {
      let currentY = topY + cubePx;
      columnPiecesPlan.forEach((size) => {
        makePiece(String(size), cubeX, currentY, 90);
        currentY += size * SCALE;
      });
    });

    horizontalPlan.bayPlans.forEach((bay, index) => {
      const startX = columnXPositions[index] + cubePx;

      let runningTopX = startX;
      bay.plan.forEach((size) => {
        makePiece(String(size), runningTopX, topY, 0);
        runningTopX += size * SCALE;
      });

      let runningBottomX = startX;
      bay.plan.forEach((size) => {
        makePiece(String(size), runningBottomX, bottomY, 0);
        runningBottomX += size * SCALE;
      });
    });

    setPieces((prev) => [...prev, ...createdPieces]);
    setSelectedId(null);
    setSelectedBoxIds(createdIds);
    setSelectionRect(null);

    if (isMobile) setSidebarOpen(false);
  }

  function addPiece(type) {
    const newPiece = {
      id: Date.now() + Math.random(),
      type,
      x: 160,
      y: 160,
      rotation: 0,
    };

    setPieces((prev) => [...prev, newPiece]);
    setSelectedId(newPiece.id);
    setSelectedBoxIds([]);

    if (isMobile) setSidebarOpen(false);
  }

  function updatePiece(id, newProps) {
    setPieces((prev) =>
      prev.map((piece) => (piece.id === id ? { ...piece, ...newProps } : piece))
    );
  }

  function deletePiece(id) {
    setPieces((prev) => prev.filter((piece) => piece.id !== id));
    setSelectedId((prev) => (prev === id ? null : prev));
    setSelectedBoxIds((prev) => prev.filter((pieceId) => pieceId !== id));
  }

  function goToOrigin() {
    if (!boardRef.current) return;
    boardRef.current.scrollTo({ left: 0, top: 0, behavior: "smooth" });
  }

  function handleNewProject() {
    const id = Date.now().toString();
    setPieces([]);
    setZoom(1);
    setSelectedId(null);
    setSelectedBoxIds([]);
    setSelectionRect(null);
    setProjectName("Novo projeto");
    setCurrentProjectId(id);
    setAutoWidth("");
    setAutoHeight("");

    if (isMobile) setSidebarOpen(false);
  }

  function handleExportProject() {
    const payload = createProjectPayload({
      id: currentProjectId,
      name: projectName,
      pieces,
      zoom,
    });

    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const safeName = (projectName || "projeto-q15")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-_]+/gi, "-");

    link.href = url;
    link.download = `${safeName || "projeto-q15"}.q15.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function handleImportClick() {
    fileInputRef.current?.click();
  }

  function handleImportFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        const project = parsed?.project || parsed;

        if (!project || !Array.isArray(project.pieces)) {
          alert("Arquivo inválido para importação.");
          return;
        }

        setPieces(project.pieces || []);
        setZoom(project.zoom || 1);
        setSelectedId(null);
        setSelectedBoxIds([]);
        setSelectionRect(null);
        setProjectName(project.name || "Projeto importado");
        setCurrentProjectId(project.id || Date.now().toString());

        if (isMobile) setSidebarOpen(false);
      } catch {
        alert("Não foi possível importar este arquivo.");
      } finally {
        event.target.value = "";
      }
    };
    reader.readAsText(file);
  }

  function handlePrintSelectedBox() {
    if (!selectedBoxIds.length || !selectedBoxBounds) {
      alert("Selecione um box antes de imprimir.");
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

    function esc(text) {
      return String(text)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
    }

    const svgElements = selectedPieces
      .map((piece) => {
        const size = getPieceSize(piece.type, piece.rotation);
        const x = piece.x - bounds.left + drawingPadding;
        const y = piece.y - bounds.top + drawingPadding;
        const isCube = piece.type === "cube";
        const isVertical = piece.rotation === 90 || piece.rotation === 270;

        if (isCube) {
          const cubeFont = Math.max(12, Math.min(26, 12 * fontCompensation));
          return `
            <g>
              <rect x="${x}" y="${y}" width="${size.width}" height="${size.height}" fill="#ffffff" stroke="#111827" stroke-width="2" />
              <text
                x="${x + size.width / 2}"
                y="${y + size.height / 2}"
                font-size="${cubeFont}"
                font-weight="700"
                fill="#111827"
                text-anchor="middle"
                dominant-baseline="middle"
              >15</text>
            </g>
          `;
        }

        const fontSize = isVertical
          ? Math.max(14, Math.min(30, 16 * fontCompensation))
          : Math.max(14, Math.min(34, 18 * fontCompensation));

        if (isVertical) {
          return `
            <g>
              <rect x="${x}" y="${y}" width="${size.width}" height="${size.height}" fill="#ffffff" stroke="#111827" stroke-width="1.6" />
              <text
                x="${x + size.width / 2}"
                y="${y + size.height / 2}"
                font-size="${fontSize}"
                font-weight="700"
                fill="#111827"
                text-anchor="middle"
                dominant-baseline="middle"
                transform="rotate(90 ${x + size.width / 2} ${y + size.height / 2})"
              >${esc(piece.type)}</text>
            </g>
          `;
        }

        return `
          <g>
            <rect x="${x}" y="${y}" width="${size.width}" height="${size.height}" fill="#ffffff" stroke="#111827" stroke-width="1.6" />
            <text
              x="${x + size.width / 2}"
              y="${y + size.height / 2}"
              font-size="${fontSize}"
              font-weight="700"
              fill="#111827"
              text-anchor="middle"
              dominant-baseline="middle"
            >${esc(piece.type)}</text>
          </g>
        `;
      })
      .join("");

    const svgMarkup = `
      <svg
        viewBox="0 0 ${svgWidth} ${svgHeight}"
        xmlns="http://www.w3.org/2000/svg"
        preserveAspectRatio="xMidYMid meet"
        style="width:100%;height:100%;display:block;background:#fff;"
      >
        ${svgElements}
      </svg>
    `;

    const usedSummaryEntries = [
      ...AVAILABLE_PIECES.filter((size) => (selectedBoxCounts[String(size)] || 0) > 0).map(
        (size) => ({
          label: `Peça ${size}`,
          value: selectedBoxCounts[String(size)],
        })
      ),
      ...(selectedBoxCounts.cube > 0
        ? [{ label: "Cubo", value: selectedBoxCounts.cube }]
        : []),
    ];

    const summaryRows = usedSummaryEntries
      .map(
        (item) => `
          <div class="summary-item">
            <span>${item.label}</span>
            <strong>${item.value}</strong>
          </div>
        `
      )
      .join("");

    const printWindow = window.open("", "_blank", "width=1300,height=900");
    if (!printWindow) return;

    printWindow.document.write(`
      <html>
        <head>
          <title>Impressão do Box</title>
          <style>
            @page { size: A4 landscape; margin: 8mm; }
            * { box-sizing: border-box; }
            html, body {
              margin: 0; padding: 0; background: #ffffff; color: #111827; font-family: Arial, sans-serif;
            }
            .page { width: 100%; display: flex; flex-direction: column; gap: 10px; }
            .header { display: flex; justify-content: flex-start; align-items: flex-start; gap: 16px; }
            .title { font-size: 20px; font-weight: 700; margin: 0; }
            .subtitle { margin-top: 3px; font-size: 11px; color: #475569; }
            .drawing-area {
              width: 100%; height: 140mm; border: 1px solid #cbd5e1; border-radius: 10px;
              background: #ffffff; padding: 8px; display: flex; align-items: center; justify-content: center; overflow: hidden;
            }
            .drawing-frame { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; }
            .drawing-svg { width: 100%; height: 100%; }
            .summary-wrap { border: 1px solid #cbd5e1; border-radius: 10px; padding: 8px 10px; background: #fff; }
            .summary-title { font-size: 13px; font-weight: 700; margin: 0 0 8px 0; }
            .summary-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px 14px; }
            .summary-item { display: flex; justify-content: space-between; gap: 10px; border-bottom: 1px dashed #cbd5e1; padding-bottom: 3px; font-size: 12px; }
            .summary-item strong { font-size: 12px; }
          </style>
        </head>
        <body>
          <div class="page">
            <div class="header">
              <div>
                <h1 class="title">${esc(projectName || "Projeto Q15")}</h1>
                <div class="subtitle">Impressão do box selecionado</div>
              </div>
            </div>
            <div class="drawing-area">
              <div class="drawing-frame">
                <div class="drawing-svg">${svgMarkup}</div>
              </div>
            </div>
            <div class="summary-wrap">
              <h2 class="summary-title">Resumo de peças usadas</h2>
              <div class="summary-grid">
                ${summaryRows || '<div class="summary-item"><span>Nenhuma peça</span><strong>0</strong></div>'}
              </div>
            </div>
          </div>
          <script>
            window.onload = () => {
              setTimeout(() => window.print(), 250);
            };
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();
  }

  function startGroupMove(e) {
    const board = boardRef.current;
    if (!board || !selectedBoxIds.length) return;

    const rect = board.getBoundingClientRect();
    const startX = (e.clientX - rect.left + board.scrollLeft) / zoom;
    const startY = (e.clientY - rect.top + board.scrollTop) / zoom;

    const original = pieces.map((p) => ({ id: p.id, x: p.x, y: p.y }));

    function handleMove(ev) {
      const currentX = (ev.clientX - rect.left + board.scrollLeft) / zoom;
      const currentY = (ev.clientY - rect.top + board.scrollTop) / zoom;

      const dx = snapToGrid(currentX - startX);
      const dy = snapToGrid(currentY - startY);

      setPieces((prev) =>
        prev.map((p) => {
          if (!selectedBoxIds.includes(p.id)) return p;
          const base = original.find((o) => o.id === p.id);
          return {
            ...p,
            x: base.x + dx,
            y: base.y + dy,
          };
        })
      );
    }

    function handleUp() {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    }

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
  }

  useEffect(() => {
    function handleKeyDown(e) {
      if (e.code === "Space") {
        e.preventDefault();
        isSpacePressedRef.current = true;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "p") {
        e.preventDefault();
        handlePrintSelectedBox();
      }

      if (e.key === "Delete" && selectedId) {
        e.preventDefault();
        deletePiece(selectedId);
      }

      if (e.key === "PageUp") {
        e.preventDefault();
        setZoom((z) => Math.min(z + 0.1, 2));
      }

      if (e.key === "PageDown") {
        e.preventDefault();
        setZoom((z) => Math.max(z - 0.1, 0.08));
      }

      if (e.key === "Escape" && isMobile) {
        setSidebarOpen(false);
      }
    }

    function handleKeyUp(e) {
      if (e.code === "Space") {
        isSpacePressedRef.current = false;
        isPanningRef.current = false;
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [selectedId, selectedBoxIds, pieces, projectName, selectedBoxBounds, selectedBoxCounts, isMobile]);

  useEffect(() => {
    const board = boardRef.current;
    if (!board) return;

    function handleWheel(e) {
      if (!e.altKey) return;
      e.preventDefault();

      const rect = board.getBoundingClientRect();
      const pointerX = e.clientX - rect.left;
      const pointerY = e.clientY - rect.top;

      setZoom((current) => {
        const next = e.deltaY < 0 ? current + 0.08 : current - 0.08;
        const clamped = Math.min(2, Math.max(0.08, Number(next.toFixed(2))));

        const worldX = (board.scrollLeft + pointerX) / current;
        const worldY = (board.scrollTop + pointerY) / current;

        requestAnimationFrame(() => {
          board.scrollLeft = worldX * clamped - pointerX;
          board.scrollTop = worldY * clamped - pointerY;
        });

        return clamped;
      });
    }

    board.addEventListener("wheel", handleWheel, { passive: false });
    return () => board.removeEventListener("wheel", handleWheel);
  }, []);

  function handleBoardMouseDown(e) {
    if (!boardRef.current) return;
    const board = boardRef.current;

    if (isSpacePressedRef.current) {
      e.preventDefault();
      isPanningRef.current = true;

      panStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        left: board.scrollLeft,
        top: board.scrollTop,
      };

      function handleMouseMove(ev) {
        if (!isPanningRef.current || !boardRef.current) return;
        const dx = ev.clientX - panStartRef.current.x;
        const dy = ev.clientY - panStartRef.current.y;
        boardRef.current.scrollLeft = panStartRef.current.left - dx;
        boardRef.current.scrollTop = panStartRef.current.top - dy;
      }

      function handleMouseUp() {
        isPanningRef.current = false;
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
      }

      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
      return;
    }

    const rect = board.getBoundingClientRect();
    const startX = (e.clientX - rect.left + board.scrollLeft) / zoom;
    const startY = (e.clientY - rect.top + board.scrollTop) / zoom;

    setSelectedId(null);
    setSelectedBoxIds([]);
    setSelectionRect({ x1: startX, y1: startY, x2: startX, y2: startY });

    function handleMouseMove(ev) {
      const currentX = (ev.clientX - rect.left + board.scrollLeft) / zoom;
      const currentY = (ev.clientY - rect.top + board.scrollTop) / zoom;
      setSelectionRect({ x1: startX, y1: startY, x2: currentX, y2: currentY });
    }

    function handleMouseUp(ev) {
      const endX = (ev.clientX - rect.left + board.scrollLeft) / zoom;
      const endY = (ev.clientY - rect.top + board.scrollTop) / zoom;
      const normalized = normalizeRect({ x1: startX, y1: startY, x2: endX, y2: endY });

      if (normalized.width > 8 || normalized.height > 8) {
        const ids = pieces
          .filter((piece) => boundsIntersect(getBounds(piece), normalized))
          .map((piece) => piece.id);

        setSelectedBoxIds(ids);
      } else {
        setSelectedBoxIds([]);
      }

      setSelectionRect(null);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    }

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  }

  function handleBoardTouchStart(e) {
    if (!boardRef.current) return;
    const board = boardRef.current;

    if (e.touches.length === 2) {
      const [t1, t2] = e.touches;
      const rect = board.getBoundingClientRect();
      const midpoint = getMidpoint(t1, t2);

      pinchStateRef.current = {
        startDistance: getDistance(t1, t2),
        startZoom: zoom,
        worldX: (board.scrollLeft + (midpoint.x - rect.left)) / zoom,
        worldY: (board.scrollTop + (midpoint.y - rect.top)) / zoom,
        midpointClientX: midpoint.x,
        midpointClientY: midpoint.y,
      };

      boardTouchRef.current.mode = "pinch";
      return;
    }

    if (e.touches.length === 1) {
      const t = e.touches[0];
      boardTouchRef.current = {
        mode: "pan",
        startX: t.clientX,
        startY: t.clientY,
        startLeft: board.scrollLeft,
        startTop: board.scrollTop,
      };
    }
  }

  function handleBoardTouchMove(e) {
    if (!boardRef.current) return;
    const board = boardRef.current;

    if (e.touches.length === 2 && pinchStateRef.current) {
      e.preventDefault();

      const [t1, t2] = e.touches;
      const rect = board.getBoundingClientRect();
      const midpoint = getMidpoint(t1, t2);
      const currentDistance = getDistance(t1, t2);

      setZoom(() => {
        const rawZoom = pinchStateRef.current.startZoom * (currentDistance / pinchStateRef.current.startDistance);
        const clamped = Math.min(2, Math.max(0.08, Number(rawZoom.toFixed(2))));

        requestAnimationFrame(() => {
          board.scrollLeft = pinchStateRef.current.worldX * clamped - (midpoint.x - rect.left);
          board.scrollTop = pinchStateRef.current.worldY * clamped - (midpoint.y - rect.top);
        });

        return clamped;
      });

      return;
    }

    if (e.touches.length === 1 && boardTouchRef.current.mode === "pan") {
      const t = e.touches[0];
      const dx = t.clientX - boardTouchRef.current.startX;
      const dy = t.clientY - boardTouchRef.current.startY;

      board.scrollLeft = boardTouchRef.current.startLeft - dx;
      board.scrollTop = boardTouchRef.current.startTop - dy;
    }
  }

  function handleBoardTouchEnd() {
    if (pinchStateRef.current) {
      pinchStateRef.current = null;
    }

    if (boardTouchRef.current.mode) {
      boardTouchRef.current.mode = null;
    }
  }

  function renderSidebarContent() {
    return (
      <div style={{ padding: isMobile ? 14 : 18 }}>
        <div
          style={{
            marginBottom: 16,
            padding: 16,
            borderRadius: 20,
            background: "linear-gradient(180deg, #16203a 0%, #101827 100%)",
            border: `1px solid ${palette.border}`,
            boxShadow: "0 12px 30px rgba(0,0,0,0.22)",
          }}
        >
          <div style={{ fontSize: 22, fontWeight: 800 }}>Editor Q15</div>
          <div style={{ marginTop: 6, fontSize: 13, color: palette.textSoft, lineHeight: 1.6 }}>
            Monte a estrutura visualmente e acompanhe o resumo das peças.
          </div>
        </div>

        <SectionCard title="Projeto">
          <label style={{ display: "block", fontSize: 12, color: palette.textSoft, marginBottom: 8 }}>
            Nome do projeto
          </label>
          <input
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            placeholder="Digite o nome do projeto"
            style={inputStyle}
          />

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
            <button onClick={handleExportProject} style={smallButtonStyle}>
              Exportar
            </button>
            <button onClick={handleImportClick} style={smallButtonStyle}>
              Importar
            </button>
            <button onClick={handleNewProject} style={smallButtonStyle}>
              Novo
            </button>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept=".json,.q15.json"
            onChange={handleImportFile}
            style={{ display: "none" }}
          />
        </SectionCard>

        <SectionCard title="Seleção de box">
          <div style={{ fontSize: 12, color: "#d7e1f7", lineHeight: 1.7 }}>
            Arraste o mouse fora das peças para selecionar um box inteiro.
            <br />
            Depois clique em qualquer peça do grupo para mover tudo junto.
            <br />
            Ctrl + P imprime apenas o box selecionado + resumo.
          </div>
        </SectionCard>

        <SectionCard
          title="Gerar box automático"
          subtitle="Digite largura x altura em cm. O sistema mantém a montagem manual e adiciona o box pronto na área."
        >
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <input
              value={autoWidth}
              onChange={(e) => setAutoWidth(e.target.value)}
              placeholder="Largura (cm)"
              style={inputStyle}
            />
            <input
              value={autoHeight}
              onChange={(e) => setAutoHeight(e.target.value)}
              placeholder="Altura (cm)"
              style={inputStyle}
            />
          </div>

          <button
            onClick={handleGenerateAutomaticBox}
            style={{ ...smallButtonStyle, width: "100%", marginTop: 10 }}
          >
            Gerar box por medida
          </button>
        </SectionCard>

        <SectionCard title="Peças Q15">
          <div style={{ display: "grid", gap: 8 }}>
            {AVAILABLE_PIECES.map((size) => (
              <button
                key={size}
                onClick={() => addPiece(String(size))}
                style={sidebarButtonStyle}
              >
                Peça {size}
              </button>
            ))}
            <button onClick={() => addPiece("cube")} style={sidebarButtonStyle}>
              Cubo 15
            </button>
          </div>
        </SectionCard>

        <SectionCard title="Resumo geral">
          <SummaryLines counts={counts} />
        </SectionCard>

        {selectedBoxIds.length > 0 && (
          <SectionCard title="Resumo do box selecionado">
            <SummaryLines counts={selectedBoxCounts} />
          </SectionCard>
        )}

        <SectionCard title="Atalhos">
          <div style={{ fontSize: 12, color: palette.textSoft, lineHeight: 1.7 }}>
            Duplo clique gira
            <br />
            Delete apaga a peça selecionada
            <br />
            Alt + scroll controla o zoom
            <br />
            Pinça no celular controla o zoom
            <br />
            Exporte em arquivo para importar depois
          </div>
        </SectionCard>
      </div>
    );
  }

  return (
    <div
      style={{
        height: "100dvh",
        overflow: "hidden",
        background: palette.bg,
        color: palette.text,
        fontFamily: "Arial, sans-serif",
        position: "relative",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(circle at top left, rgba(59,130,246,0.14), transparent 28%), radial-gradient(circle at top right, rgba(99,102,241,0.12), transparent 22%), linear-gradient(180deg, #08101f 0%, #0a1222 100%)",
          pointerEvents: "none",
        }}
      />

      <div
        style={{
          position: "fixed",
          left: 0,
          right: 0,
          top: 0,
          height: topBarHeight,
          zIndex: 50,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: isMobile ? "0 12px" : "0 18px",
          background: "rgba(8, 16, 31, 0.86)",
          backdropFilter: "blur(14px)",
          borderBottom: `1px solid ${palette.border}`,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
          {isMobile && (
            <button
              onClick={() => setSidebarOpen(true)}
              style={{
                ...controlButtonStyle,
                padding: "10px 12px",
                minWidth: 44,
              }}
            >
              ☰
            </button>
          )}

          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: isMobile ? 16 : 18, fontWeight: 800 }}>
              Q15 Builder
            </div>
            <div
              style={{
                fontSize: 12,
                color: palette.textSoft,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                maxWidth: isMobile ? 180 : 320,
              }}
            >
              {projectName || "Novo projeto"}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {!isMobile && (
            <>
              <button onClick={handleExportProject} style={smallButtonStyle}>
                Exportar
              </button>
              <button onClick={handleImportClick} style={smallButtonStyle}>
                Importar
              </button>
            </>
          )}

          <div
            style={{
              padding: "10px 12px",
              borderRadius: 12,
              border: `1px solid ${palette.border}`,
              background: palette.panel,
              fontSize: 12,
              color: palette.textSoft,
            }}
          >
            Zoom {(zoom * 100).toFixed(0)}%
          </div>
        </div>
      </div>

      {!isMobile && (
        <div
          style={{
            position: "absolute",
            left: 0,
            top: topBarHeight,
            bottom: 0,
            width: sidebarWidth,
            background: "rgba(10,17,32,0.84)",
            borderRight: `1px solid ${palette.border}`,
            overflowY: "auto",
            zIndex: 30,
            backdropFilter: "blur(14px)",
          }}
        >
          {renderSidebarContent()}
        </div>
      )}

      {isMobile && sidebarOpen && (
        <>
          <div
            onClick={() => setSidebarOpen(false)}
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 59,
              background: "rgba(0,0,0,0.45)",
            }}
          />
          <div
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              bottom: 0,
              width: sidebarWidth,
              zIndex: 60,
              background: "rgba(10,17,32,0.98)",
              borderRight: `1px solid ${palette.border}`,
              overflowY: "auto",
              boxShadow: "20px 0 60px rgba(0,0,0,0.45)",
            }}
          >
            <div
              style={{
                position: "sticky",
                top: 0,
                zIndex: 2,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "14px 14px 10px",
                background: "rgba(10,17,32,0.98)",
                borderBottom: `1px solid ${palette.border}`,
              }}
            >
              <div style={{ fontWeight: 800, fontSize: 16 }}>Menu do projeto</div>
              <button onClick={() => setSidebarOpen(false)} style={controlButtonStyle}>
                ✕
              </button>
            </div>
            {renderSidebarContent()}
          </div>
        </>
      )}

      <div
        ref={boardRef}
        onMouseDown={handleBoardMouseDown}
        onTouchStart={handleBoardTouchStart}
        onTouchMove={handleBoardTouchMove}
        onTouchEnd={handleBoardTouchEnd}
        style={{
          position: "absolute",
          left: isMobile ? 0 : sidebarWidth,
          right: 0,
          top: topBarHeight,
          bottom: isMobile ? bottomToolbarHeight : 0,
          overflow: "auto",
          background: palette.canvas,
          padding: isMobile ? 12 : 20,
          cursor: isSpacePressedRef.current
            ? isPanningRef.current
              ? "grabbing"
              : "grab"
            : "crosshair",
          touchAction: "none",
        }}
      >
        <div
          style={{
            width: 30000 * zoom,
            height: 8000 * zoom,
            position: "relative",
          }}
        >
          <div
            style={{
              width: 30000,
              height: 8000,
              position: "relative",
              borderRadius: isMobile ? 18 : 24,
              border: "1px solid #cad4e2",
              backgroundColor: "#ffffff",
              backgroundImage:
                "linear-gradient(rgba(15,23,42,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(15,23,42,0.05) 1px, transparent 1px)",
              backgroundSize: `${GRID * 2}px ${GRID * 2}px`,
              boxShadow: "0 14px 40px rgba(15,23,42,0.10)",
              transform: `scale(${zoom})`,
              transformOrigin: "top left",
            }}
          >
            {selectionRect &&
              (() => {
                const rect = normalizeRect(selectionRect);
                return (
                  <div
                    style={{
                      position: "absolute",
                      left: rect.left,
                      top: rect.top,
                      width: rect.width,
                      height: rect.height,
                      border: "2px dashed #2563eb",
                      background: "rgba(37,99,235,0.08)",
                      pointerEvents: "none",
                      zIndex: 10,
                    }}
                  />
                );
              })()}

            {selectedBoxBounds && (
              <div
                style={{
                  position: "absolute",
                  left: selectedBoxBounds.left - 8,
                  top: selectedBoxBounds.top - 8,
                  width: selectedBoxBounds.right - selectedBoxBounds.left + 16,
                  height: selectedBoxBounds.bottom - selectedBoxBounds.top + 16,
                  border: "2px solid #2563eb",
                  background: "rgba(37,99,235,0.04)",
                  pointerEvents: "none",
                  zIndex: 9,
                  boxSizing: "border-box",
                  borderRadius: 6,
                }}
              />
            )}

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
                isMobile={isMobile}
              />
            ))}
          </div>
        </div>
      </div>

      {!isMobile && (
        <div
          style={{
            position: "fixed",
            right: 20,
            bottom: 20,
            background: "rgba(17,24,39,0.94)",
            border: `1px solid ${palette.border}`,
            padding: 10,
            borderRadius: 16,
            display: "flex",
            gap: 8,
            zIndex: 80,
            boxShadow: "0 10px 30px rgba(0,0,0,0.35)",
            backdropFilter: "blur(12px)",
          }}
        >
          <button
            onClick={() => setZoom((z) => Math.min(z + 0.1, 2))}
            style={controlButtonStyle}
          >
            +
          </button>
          <button
            onClick={() => setZoom((z) => Math.max(z - 0.1, 0.08))}
            style={controlButtonStyle}
          >
            -
          </button>
          <button onClick={() => setZoom(1)} style={controlButtonStyle}>
            Reset
          </button>
          <button onClick={goToOrigin} style={controlButtonStyle}>
            Início
          </button>
          <button onClick={handleNewProject} style={controlButtonStyle}>
            Novo
          </button>
        </div>
      )}

      {isMobile && (
        <div
          style={{
            position: "fixed",
            left: 10,
            right: 10,
            bottom: 10,
            zIndex: 80,
            display: "grid",
            gridTemplateColumns: "repeat(5, 1fr)",
            gap: 8,
            padding: 10,
            borderRadius: 18,
            background: "rgba(17,24,39,0.96)",
            border: `1px solid ${palette.border}`,
            boxShadow: "0 14px 35px rgba(0,0,0,0.35)",
            backdropFilter: "blur(12px)",
          }}
        >
          <button onClick={() => setSidebarOpen(true)} style={controlButtonStyle}>
            Menu
          </button>
          <button onClick={() => setZoom((z) => Math.max(z - 0.1, 0.08))} style={controlButtonStyle}>
            -
          </button>
          <button onClick={() => setZoom((z) => Math.min(z + 0.1, 2))} style={controlButtonStyle}>
            +
          </button>
          <button onClick={() => setZoom(1)} style={controlButtonStyle}>
            100%
          </button>
          <button onClick={handleNewProject} style={controlButtonStyle}>
            Novo
          </button>
        </div>
      )}
    </div>
  );
}

function Piece({
  piece,
  pieces,
  boardRef,
  updatePiece,
  deletePiece,
  selected,
  onSelect,
  zoom,
  isSpacePressedRef,
  selectedBoxIds,
  startGroupMove,
  isMobile,
}) {
  const offsetRef = useRef({ x: 0, y: 0 });
  const touchStartRef = useRef({ x: 0, y: 0, pieceX: 0, pieceY: 0 });
  const { width, height } = getPieceSize(piece.type, piece.rotation);
  const isCube = piece.type === "cube";
  const isVertical = piece.rotation === 90 || piece.rotation === 270;

  function handleMouseDown(e) {
    if (isSpacePressedRef.current) return;

    e.preventDefault();
    e.stopPropagation();
    onSelect();

    if (selectedBoxIds.includes(piece.id)) {
      startGroupMove(e);
      return;
    }

    const board = boardRef.current;
    if (!board) return;

    const boardRect = board.getBoundingClientRect();

    offsetRef.current = {
      x: (e.clientX - boardRect.left + board.scrollLeft) / zoom - piece.x,
      y: (e.clientY - boardRect.top + board.scrollTop) / zoom - piece.y,
    };

    function handleMouseMove(ev) {
      const rawX =
        (ev.clientX - boardRect.left + board.scrollLeft) / zoom - offsetRef.current.x;
      const rawY =
        (ev.clientY - boardRect.top + board.scrollTop) / zoom - offsetRef.current.y;

      const snapped = applyMagneticSnap(rawX, rawY, piece, pieces);
      updatePiece(piece.id, {
        x: snapped.x,
        y: snapped.y,
      });
    }

    function handleMouseUp() {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    }

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  }

  function handleTouchStart(e) {
    if (e.touches.length !== 1) return;

    e.stopPropagation();
    onSelect();

    const board = boardRef.current;
    if (!board) return;

    const touch = e.touches[0];
    const boardRect = board.getBoundingClientRect();

    touchStartRef.current = {
      x: (touch.clientX - boardRect.left + board.scrollLeft) / zoom,
      y: (touch.clientY - boardRect.top + board.scrollTop) / zoom,
      pieceX: piece.x,
      pieceY: piece.y,
    };
  }

  function handleTouchMove(e) {
    if (e.touches.length !== 1) return;

    e.preventDefault();
    e.stopPropagation();

    const board = boardRef.current;
    if (!board) return;

    const touch = e.touches[0];
    const boardRect = board.getBoundingClientRect();

    const currentX = (touch.clientX - boardRect.left + board.scrollLeft) / zoom;
    const currentY = (touch.clientY - boardRect.top + board.scrollTop) / zoom;

    const dx = currentX - touchStartRef.current.x;
    const dy = currentY - touchStartRef.current.y;

    const rawX = touchStartRef.current.pieceX + dx;
    const rawY = touchStartRef.current.pieceY + dy;

    const snapped = applyMagneticSnap(rawX, rawY, piece, pieces);
    updatePiece(piece.id, {
      x: snapped.x,
      y: snapped.y,
    });
  }

  function handleDoubleClick(e) {
    if (isSpacePressedRef.current) return;

    e.preventDefault();
    e.stopPropagation();
    onSelect();

    updatePiece(piece.id, {
      rotation: (piece.rotation + 90) % 360,
    });
  }

  function handleContextMenu(e) {
    e.preventDefault();
    e.stopPropagation();
    deletePiece(piece.id);
  }

  return (
    <div
      onMouseDown={handleMouseDown}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onDoubleClick={handleDoubleClick}
      onContextMenu={handleContextMenu}
      title="Duplo clique gira | Delete apaga | Botão direito apaga"
      style={{
        position: "absolute",
        left: piece.x,
        top: piece.y,
        width,
        height,
        background: "#ffffff",
        color: "#0f172a",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: isSpacePressedRef.current ? "grabbing" : "grab",
        userSelect: "none",
        border: selected ? "2px solid #3b82f6" : "1px solid #111827",
        boxSizing: "border-box",
        overflow: "hidden",
        boxShadow: selected
          ? "0 0 0 2px rgba(59,130,246,0.15)"
          : "0 1px 2px rgba(0,0,0,0.08)",
        zIndex: 20,
        borderRadius: isMobile ? 2 : 0,
        touchAction: "none",
      }}
    >
      {isCube ? (
        <div
          style={{
            width: "100%",
            height: "100%",
            background: "#ffffff",
            border: "2px solid #111827",
            boxSizing: "border-box",
            position: "relative",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: 0,
              height: "18%",
              background: "#e5e7eb",
              borderBottom: "2px solid #111827",
            }}
          />
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 0,
              height: "18%",
              background: "#e5e7eb",
              borderTop: "2px solid #111827",
            }}
          />
          <div
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              bottom: 0,
              width: "14%",
              background: "#d1d5db",
              borderRight: "2px solid #111827",
            }}
          />
          <div
            style={{
              position: "absolute",
              right: 0,
              top: 0,
              bottom: 0,
              width: "14%",
              background: "#d1d5db",
              borderLeft: "2px solid #111827",
            }}
          />
          <div
            style={{
              position: "absolute",
              left: "20%",
              right: "20%",
              top: "28%",
              bottom: "28%",
              background: "#ffffff",
              border: "1px dashed rgba(17,24,39,0.35)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <span style={{ fontSize: 11, fontWeight: 700, color: "#111827" }}>
              15
            </span>
          </div>
          <div style={{ position: "absolute", width: 6, height: 6, borderRadius: "50%", background: "#111827", top: "6%", left: "30%" }} />
          <div style={{ position: "absolute", width: 6, height: 6, borderRadius: "50%", background: "#111827", top: "6%", right: "30%" }} />
          <div style={{ position: "absolute", width: 6, height: 6, borderRadius: "50%", background: "#111827", bottom: "6%", left: "30%" }} />
          <div style={{ position: "absolute", width: 6, height: 6, borderRadius: "50%", background: "#111827", bottom: "6%", right: "30%" }} />
        </div>
      ) : (
        <div
          style={{
            width: "100%",
            height: "100%",
            position: "relative",
            background: "#ffffff",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: 0,
              border: "1px solid #111827",
              pointerEvents: "none",
            }}
          />

          {isVertical ? (
            <>
              <div style={{ position: "absolute", left: "10%", top: 0, bottom: 0, width: 2, background: "#111827" }} />
              <div style={{ position: "absolute", right: "10%", top: 0, bottom: 0, width: 2, background: "#111827" }} />
              <div style={{ position: "absolute", left: "18%", top: "12%", width: "54%", height: 2, background: "#111827", transform: "rotate(35deg)", transformOrigin: "left center" }} />
              <div style={{ position: "absolute", right: "18%", top: "28%", width: "54%", height: 2, background: "#111827", transform: "rotate(-35deg)", transformOrigin: "right center" }} />
              <div style={{ position: "absolute", left: "18%", top: "50%", width: "54%", height: 2, background: "#111827", transform: "rotate(35deg)", transformOrigin: "left center" }} />
              <div style={{ position: "absolute", right: "18%", top: "66%", width: "54%", height: 2, background: "#111827", transform: "rotate(-35deg)", transformOrigin: "right center" }} />
              <div
                style={{
                  position: "absolute",
                  left: "28%",
                  right: "28%",
                  top: "18%",
                  bottom: "18%",
                  background: "#ffffff",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <span
                  style={{
                    transform: "rotate(90deg)",
                    whiteSpace: "nowrap",
                    lineHeight: 1,
                    fontSize: 16,
                    fontWeight: 700,
                    letterSpacing: 0.4,
                    color: "#111827",
                  }}
                >
                  {piece.type}
                </span>
              </div>
            </>
          ) : (
            <>
              <div style={{ position: "absolute", top: "10%", left: 0, right: 0, height: 2, background: "#111827" }} />
              <div style={{ position: "absolute", bottom: "10%", left: 0, right: 0, height: 2, background: "#111827" }} />
              <div style={{ position: "absolute", left: "12%", top: "24%", width: "22%", height: 2, background: "#111827", transform: "rotate(18deg)", transformOrigin: "left center" }} />
              <div style={{ position: "absolute", left: "30%", top: "62%", width: "22%", height: 2, background: "#111827", transform: "rotate(-18deg)", transformOrigin: "left center" }} />
              <div style={{ position: "absolute", right: "30%", top: "24%", width: "22%", height: 2, background: "#111827", transform: "rotate(-18deg)", transformOrigin: "right center" }} />
              <div style={{ position: "absolute", right: "12%", top: "62%", width: "22%", height: 2, background: "#111827", transform: "rotate(18deg)", transformOrigin: "right center" }} />
              <div
                style={{
                  position: "absolute",
                  left: "26%",
                  right: "26%",
                  top: "18%",
                  bottom: "18%",
                  background: "#ffffff",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <span
                  style={{
                    whiteSpace: "nowrap",
                    lineHeight: 1,
                    fontSize: 18,
                    fontWeight: 700,
                    letterSpacing: 0.4,
                    color: "#111827",
                  }}
                >
                  {piece.type}
                </span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}