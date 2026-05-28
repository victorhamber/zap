import { MiniMap, Panel, useReactFlow } from "@xyflow/react";

type Props = {
  panelOpen: boolean;
};

export function FlowZoomToolbar({ panelOpen }: Props) {
  const { zoomIn, zoomOut, fitView } = useReactFlow();

  function centerView() {
    fitView({ padding: 0.4, maxZoom: 0.75, duration: 280 });
  }

  return (
    <Panel
      position="bottom-right"
      className={`flow-bottom-toolbar !m-3 ${panelOpen ? "flow-bottom-toolbar--panel-open" : ""}`}
    >
      <div className="flex items-end gap-2">
        <div className="flex flex-col overflow-hidden rounded-xl border border-zinc-600 bg-zinc-900 shadow-xl">
          <button
            type="button"
            title="Aumentar zoom"
            onClick={() => zoomIn({ duration: 150 })}
            className="flow-zoom-btn border-b border-zinc-700"
          >
            +
          </button>
          <button
            type="button"
            title="Diminuir zoom"
            onClick={() => zoomOut({ duration: 150 })}
            className="flow-zoom-btn border-b border-zinc-700"
          >
            −
          </button>
          <button
            type="button"
            title="Centralizar fluxo"
            onClick={centerView}
            className="flow-zoom-btn text-base"
          >
            ⊡
          </button>
        </div>

        <MiniMap
          pannable
          zoomable
          className="flow-minimap-inner !static !m-0 !rounded-xl !border-zinc-600 !bg-zinc-900"
          nodeColor={() => "#34d399"}
          maskColor="rgba(9, 9, 11, 0.8)"
          style={{ width: 180, height: 120 }}
        />
      </div>
    </Panel>
  );
}
