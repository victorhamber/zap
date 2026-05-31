type Props = {
  x: number;
  y: number;
  onEdit?: () => void;
  onDelete: () => void;
  deleteLabel?: string;
  onClose: () => void;
};

export function NodeContextMenu({ x, y, onEdit, onDelete, deleteLabel, onClose }: Props) {
  return (
    <>
      <div className="fixed inset-0 z-[60]" onClick={onClose} onContextMenu={(e) => e.preventDefault()} />
      <div
        className="fixed z-[61] min-w-[160px] rounded-xl border border-zinc-700 bg-zinc-900 py-1 shadow-2xl"
        style={{ left: x, top: y }}
        onContextMenu={(e) => e.preventDefault()}
      >
        {onEdit && (
          <button
            type="button"
            className="w-full px-4 py-2 text-left text-sm text-zinc-200 hover:bg-zinc-800"
            onClick={() => {
              onEdit();
              onClose();
            }}
          >
            Editar propriedades
          </button>
        )}
        <button
          type="button"
          className="w-full px-4 py-2 text-left text-sm text-red-300 hover:bg-red-950/50"
          onClick={() => {
            onDelete();
            onClose();
          }}
        >
          {deleteLabel ?? "Excluir bloco"}
        </button>
      </div>
    </>
  );
}
