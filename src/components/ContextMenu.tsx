import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type Ref,
} from "react";

export interface MenuItem {
  id: string;
  label: string;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  separator?: boolean;
  submenu?: MenuItem[];
}

const MARGIN = 8;

/** Place a box near (x,y): prefer below/right; flip above/left when needed. */
function fitMenu(
  x: number,
  y: number,
  width: number,
  height: number,
  preferAbove = false,
): { left: number; top: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const spaceBelow = vh - y - MARGIN;
  const spaceAbove = y - MARGIN;

  let top: number;
  if (preferAbove || (height > spaceBelow && spaceAbove >= spaceBelow)) {
    // Open upward: bottom edge near pointer
    top = y - height;
  } else {
    top = y;
  }
  // Keep fully in viewport when possible
  if (top + height > vh - MARGIN) top = vh - MARGIN - height;
  if (top < MARGIN) top = MARGIN;

  let left = x;
  if (left + width > vw - MARGIN) left = x - width;
  if (left < MARGIN) left = MARGIN;
  if (left + width > vw - MARGIN) left = Math.max(MARGIN, vw - MARGIN - width);

  return { left, top };
}

function fitSubmenu(
  anchor: DOMRect,
  width: number,
  height: number,
): { left: number; top: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let left = anchor.right - 2;
  if (left + width > vw - MARGIN) left = anchor.left - width + 2;
  if (left < MARGIN) left = MARGIN;

  let top = anchor.top;
  if (top + height > vh - MARGIN) top = vh - MARGIN - height;
  if (top < MARGIN) top = MARGIN;
  return { left, top };
}

interface Props {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
  onSelect: (id: string) => void;
}

function MenuList(props: {
  items: MenuItem[];
  onSelect: (id: string) => void;
  onClose: () => void;
  className?: string;
  style?: CSSProperties;
  menuRef?: Ref<HTMLDivElement>;
}) {
  const [openSub, setOpenSub] = useState<string | null>(null);
  const [subPos, setSubPos] = useState({ left: 0, top: 0 });
  const itemRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const subRef = useRef<HTMLDivElement>(null);

  const placeSub = (itemId: string) => {
    const el = itemRefs.current[itemId];
    if (!el) return;
    const r = el.getBoundingClientRect();
    // Provisional; refined after submenu mounts
    setSubPos({ left: r.right - 2, top: r.top });
    setOpenSub(itemId);
  };

  useLayoutEffect(() => {
    if (!openSub || !subRef.current) return;
    const el = itemRefs.current[openSub];
    if (!el) return;
    const anchor = el.getBoundingClientRect();
    const sub = subRef.current.getBoundingClientRect();
    setSubPos(fitSubmenu(anchor, sub.width, sub.height));
  }, [openSub, props.items]);

  return (
    <div
      ref={props.menuRef}
      className={props.className ?? "ctx-menu"}
      style={props.style}
      role="menu"
    >
      {props.items.map((item, i) =>
        item.separator ? (
          <div className="ctx-sep" key={`sep-${i}`} />
        ) : (
          <div key={item.id} className="ctx-item-wrap">
            <button
              ref={(el) => {
                itemRefs.current[item.id] = el;
              }}
              className={`ctx-item ${item.danger ? "danger" : ""} ${item.submenu ? "has-sub" : ""}`}
              disabled={item.disabled}
              role="menuitem"
              onMouseEnter={() => {
                if (item.disabled || !item.submenu) {
                  setOpenSub(null);
                  return;
                }
                placeSub(item.id);
              }}
              onClick={() => {
                if (item.disabled) return;
                if (item.submenu?.length) {
                  placeSub(item.id);
                  return;
                }
                props.onSelect(item.id);
                props.onClose();
              }}
            >
              <span className="ctx-label">{item.label}</span>
              {item.shortcut && <span className="ctx-shortcut">{item.shortcut}</span>}
              {item.submenu && <span className="ctx-caret">▸</span>}
            </button>
            {openSub === item.id && item.submenu && (
              <MenuList
                menuRef={subRef}
                className="ctx-menu ctx-submenu"
                style={{ left: subPos.left, top: subPos.top, position: "fixed" }}
                items={item.submenu}
                onSelect={props.onSelect}
                onClose={props.onClose}
              />
            )}
          </div>
        ),
      )}
    </div>
  );
}

export function ContextMenu({ x, y, items, onClose, onSelect }: Props) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  const [ready, setReady] = useState(false);

  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    // Measure at current (possibly off-screen) position, then fit.
    const rect = el.getBoundingClientRect();
    const next = fitMenu(x, y, rect.width, rect.height);
    setPos(next);
    setReady(true);
  }, [x, y, items]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) {
        // Submenus are position:fixed inside menu tree — also check closest .ctx-menu
        const t = e.target as HTMLElement | null;
        if (t?.closest?.(".ctx-menu")) return;
        onClose();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onScroll = () => onClose();
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [onClose]);

  return (
    <MenuList
      menuRef={menuRef}
      style={{
        left: pos.left,
        top: pos.top,
        position: "fixed",
        zIndex: 1000,
        // Hide until measured to avoid one-frame jump at wrong edge
        visibility: ready ? "visible" : "hidden",
      }}
      items={items}
      onSelect={onSelect}
      onClose={onClose}
    />
  );
}

export function useContextMenu() {
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    items: MenuItem[];
    onSelect: (id: string) => void;
  } | null>(null);

  const openMenu = (
    e: ReactMouseEvent,
    items: MenuItem[],
    onSelect: (id: string) => void,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, items, onSelect });
  };

  const closeMenu = () => setMenu(null);

  const menuNode = menu ? (
    <ContextMenu
      x={menu.x}
      y={menu.y}
      items={menu.items}
      onClose={closeMenu}
      onSelect={menu.onSelect}
    />
  ) : null;

  return { openMenu, closeMenu, menuNode };
}
