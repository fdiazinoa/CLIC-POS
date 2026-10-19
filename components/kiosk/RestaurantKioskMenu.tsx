import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  ChevronRight,
  Minus,
  Plus,
  Search,
  ShoppingBag,
  Trash2,
  UtensilsCrossed,
  X,
} from 'lucide-react';
import type { CartItem, OrderServiceType, Product } from '../../types';
import { resolveProductImageSrc } from '../../utils/entityImage';
import './RestaurantKiosk.css';

interface RestaurantKioskMenuProps {
  storeName: string;
  serviceType?: Extract<OrderServiceType, 'DINE_IN' | 'TAKEOUT'> | null;
  products: Product[];
  catalogProducts: Product[];
  categories: string[];
  selectedCategory: string;
  searchQuery: string;
  cart: CartItem[];
  subtotal: number;
  itemCount: number;
  checkoutError: string;
  feedback: string | null;
  selectedCustomerName?: string;
  couponCode?: string;
  formatMoney: (value: number) => string;
  displayCategory: (value: unknown) => string;
  getPrice: (product: Product) => number;
  getAvailability: (product: Product) => { canSell: boolean; reason: string };
  onSearch: (value: string) => void;
  onCategory: (value: string) => void;
  onProduct: (product: Product) => void;
  onIncrease: (item: CartItem) => void;
  onDecrease: (item: CartItem) => void;
  onRemove: (cartId: string) => void;
  onCheckout: () => void;
  onCancel: () => void;
}

export function RestaurantCatalogImage({
  product,
  className = '',
  eager = false,
}: {
  product?: Product;
  className?: string;
  eager?: boolean;
}) {
  const source = resolveProductImageSrc(product);
  const [failedSource, setFailedSource] = useState<string | null>(null);
  return source && source !== failedSource ? (
    <img
      className={className}
      src={source}
      alt={product?.name || ''}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      onError={() => setFailedSource(source)}
    />
  ) : (
    <span
      className={`restaurant-image-placeholder ${className}`}
      aria-label="Sin imagen"
    >
      <UtensilsCrossed aria-hidden="true" />
    </span>
  );
}

function RestaurantOrder({
  cart,
  subtotal,
  formatMoney,
  onIncrease,
  onDecrease,
  onRemove,
  onCheckout,
  onCancel,
  checkoutError,
  selectedCustomerName,
  couponCode,
}: RestaurantKioskMenuProps) {
  return (
    <>
      <div className="restaurant-order-lines">
        {cart.length === 0 ? (
          <div className="restaurant-order-empty">
            <ShoppingBag size={44} aria-hidden="true" />
            <h3>Tu pedido empieza aquí</h3>
            <p>Explora el menú y elige lo que más te guste.</p>
          </div>
        ) : (
          cart.map((item) => (
            <article
              key={item.cartId || item.id}
              className="restaurant-order-line"
            >
              <RestaurantCatalogImage
                product={item}
                className="restaurant-order-image"
              />
              <div className="restaurant-order-line-info">
                <h3>{item.name}</h3>
                {item.modifiers?.length ? (
                  <p>{item.modifiers.join(' · ')}</p>
                ) : null}
                {item.note ? (
                  <p className="restaurant-order-note">{item.note}</p>
                ) : null}
                <strong>{formatMoney(item.price * item.quantity)}</strong>
                <div className="restaurant-quantity">
                  <button
                    type="button"
                    aria-label={`Quitar una unidad de ${item.name}`}
                    onClick={() => onDecrease(item)}
                  >
                    <Minus size={20} />
                  </button>
                  <span aria-label="Cantidad">{item.quantity}</span>
                  <button
                    type="button"
                    aria-label={`Agregar una unidad de ${item.name}`}
                    onClick={() => onIncrease(item)}
                  >
                    <Plus size={20} />
                  </button>
                </div>
              </div>
              <button
                type="button"
                className="restaurant-remove"
                aria-label={`Eliminar ${item.name}`}
                onClick={() => onRemove(item.cartId || item.id)}
              >
                <Trash2 size={20} />
              </button>
            </article>
          ))
        )}
      </div>
      <footer className="restaurant-order-footer">
        {selectedCustomerName ? (
          <p className="restaurant-order-context">
            Cliente: {selectedCustomerName}
          </p>
        ) : null}
        {couponCode ? (
          <p className="restaurant-order-context">Cupón: {couponCode}</p>
        ) : null}
        <div className="restaurant-subtotal">
          <span>Subtotal del pedido</span>
          <strong>{formatMoney(subtotal)}</strong>
        </div>
        <p className="restaurant-payment-hint">
          Revisa los impuestos y el total final en el siguiente paso.
        </p>
        {checkoutError ? (
          <p role="alert" className="restaurant-checkout-error">
            {checkoutError}
          </p>
        ) : null}
        <button
          type="button"
          className="restaurant-primary"
          disabled={cart.length === 0}
          onClick={onCheckout}
        >
          Continuar al pago <ArrowRight size={22} />
        </button>
        <button type="button" className="restaurant-cancel" onClick={onCancel}>
          Cancelar pedido
        </button>
      </footer>
    </>
  );
}

const PAGE_SIZE = 30;

export default function RestaurantKioskMenu(props: RestaurantKioskMenuProps) {
  const {
    storeName,
    serviceType,
    products,
    catalogProducts,
    categories,
    selectedCategory,
    searchQuery,
    cart,
    subtotal,
    itemCount,
    formatMoney,
    displayCategory,
    getPrice,
    getAvailability,
    onSearch,
    onCategory,
    onProduct,
    feedback,
  } = props;
  const [page, setPage] = useState(0);
  const [reviewOpen, setReviewOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const lastPage = Math.max(0, Math.ceil(products.length / PAGE_SIZE) - 1);
  const currentPage = Math.min(page, lastPage);
  const visibleProducts = products.slice(
    currentPage * PAGE_SIZE,
    (currentPage + 1) * PAGE_SIZE,
  );
  const categoryImages = useMemo(() => {
    const images = new Map<string, Product>();
    for (const product of catalogProducts) {
      const category = displayCategory(product.category);
      if (!images.has(category) && resolveProductImageSrc(product))
        images.set(category, product);
    }
    return images;
  }, [catalogProducts, displayCategory]);
  const heroProduct = products.find((product) =>
    Boolean(resolveProductImageSrc(product)),
  );

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (reviewOpen && !dialog.open) {
      returnFocusRef.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      dialog.showModal();
    } else if (!reviewOpen && dialog.open) {
      dialog.close();
      const opener = returnFocusRef.current;
      if (opener?.isConnected && !opener.matches(':disabled')) opener.focus();
      else searchRef.current?.focus();
    }
  }, [reviewOpen]);

  const resetMenuPosition = () => menuRef.current?.scrollTo({ top: 0 });
  const changeCategory = (category: string) => {
    setPage(0);
    onCategory(category);
    resetMenuPosition();
  };
  const changeSearch = (value: string) => {
    setPage(0);
    onSearch(value);
    resetMenuPosition();
  };
  const changePage = (next: number) => {
    setPage(next);
    resetMenuPosition();
  };
  const serviceLabel = serviceType === 'TAKEOUT' ? 'Para llevar' : 'Comer aquí';

  return (
    <div className="restaurant-kiosk" data-restaurant-kiosk="true">
      <header className="restaurant-menu-header">
        <div className="restaurant-brand">
          <span className="restaurant-brand-mark">
            <UtensilsCrossed aria-hidden="true" />
          </span>
          <div>
            <p>BIENVENIDO A</p>
            <h1>{storeName}</h1>
          </div>
        </div>
        <div className="restaurant-header-actions">
          <span className="restaurant-service">
            <ShoppingBag size={20} aria-hidden="true" />
            {serviceLabel}
          </span>
          {cart.length === 0 ? (
            <button
              type="button"
              className="restaurant-home"
              onClick={props.onCancel}
            >
              <ArrowLeft size={19} /> Volver al inicio
            </button>
          ) : null}
        </div>
      </header>
      <div className="restaurant-menu-layout">
        <nav
          className="restaurant-category-rail"
          aria-label="Categorías del menú"
        >
          {categories.map((category) => (
            <button
              type="button"
              key={category}
              title={category}
              aria-pressed={selectedCategory === category}
              onClick={() => changeCategory(category)}
            >
              <RestaurantCatalogImage
                product={categoryImages.get(category)}
                className="restaurant-category-image"
              />
              <span>{category}</span>
            </button>
          ))}
        </nav>
        <main className="restaurant-menu-main">
          <label className="restaurant-search">
            <Search size={23} aria-hidden="true" />
            <span className="sr-only">Buscar en el menú</span>
            <input
              ref={searchRef}
              type="search"
              value={searchQuery}
              onChange={(event) => changeSearch(event.target.value)}
              placeholder="¿Qué se te antoja hoy?"
            />
            {searchQuery ? (
              <button
                type="button"
                aria-label="Limpiar búsqueda"
                onClick={() => changeSearch('')}
              >
                <X size={22} />
              </button>
            ) : null}
          </label>
          <div className="restaurant-menu-scroll" ref={menuRef}>
            {!searchQuery && currentPage === 0 ? (
              <section
                className="restaurant-menu-hero"
                aria-label="Explora nuestro menú"
              >
                <div>
                  <p className="restaurant-eyebrow">HECHO A TU GUSTO</p>
                  <h2>
                    {heroProduct
                      ? heroProduct.name
                      : 'Tu próxima elección empieza aquí.'}
                  </h2>
                  <p>
                    {heroProduct
                      ? formatMoney(getPrice(heroProduct))
                      : 'Explora el menú y prepara tu pedido.'}
                  </p>
                  {heroProduct ? (
                    <button
                      type="button"
                      className="restaurant-hero-action"
                      disabled={!getAvailability(heroProduct).canSell}
                      onClick={() => onProduct(heroProduct)}
                    >
                      Ver opciones <ArrowRight size={20} />
                    </button>
                  ) : null}
                </div>
                <RestaurantCatalogImage
                  product={heroProduct}
                  className="restaurant-hero-image"
                  eager
                />
              </section>
            ) : null}
            <div className="restaurant-menu-heading">
              <div>
                <p className="restaurant-eyebrow">EXPLORA Y ELIGE</p>
                <h2>
                  {searchQuery
                    ? 'Resultados de búsqueda'
                    : selectedCategory === 'Todos'
                      ? 'Nuestro menú'
                      : selectedCategory}
                </h2>
              </div>
              <span>{products.length} opciones</span>
            </div>
            <div className="restaurant-product-grid">
              {visibleProducts.map((product) => {
                const availability = getAvailability(product);
                return (
                  <button
                    type="button"
                    key={product.id}
                    className="restaurant-product-card"
                    disabled={!availability.canSell}
                    onClick={() => onProduct(product)}
                  >
                    <div className="restaurant-product-media">
                      <RestaurantCatalogImage product={product} />
                      {!availability.canSell ? (
                        <span className="restaurant-unavailable">
                          {availability.reason || 'No disponible'}
                        </span>
                      ) : null}
                    </div>
                    <div className="restaurant-product-info">
                      <span className="restaurant-product-category">
                        {displayCategory(product.category)}
                      </span>
                      <h3>{product.name}</h3>
                      <div>
                        <strong>{formatMoney(getPrice(product))}</strong>
                        <span className="restaurant-add" aria-hidden="true">
                          <Plus size={23} />
                        </span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
            {!products.length ? (
              <div className="restaurant-no-results">
                <Search size={40} aria-hidden="true" />
                <h3>No encontramos ese producto</h3>
                <p>Prueba otra búsqueda o elige una categoría.</p>
              </div>
            ) : null}
            {products.length > PAGE_SIZE ? (
              <nav
                className="restaurant-pagination"
                aria-label="Páginas del menú"
              >
                <button
                  type="button"
                  aria-label="Página anterior"
                  disabled={currentPage === 0}
                  onClick={() => changePage(currentPage - 1)}
                >
                  <ArrowLeft size={21} /> Anterior
                </button>
                <span aria-live="polite">
                  {currentPage + 1} / {lastPage + 1}
                </span>
                <button
                  type="button"
                  aria-label="Siguiente página"
                  disabled={currentPage === lastPage}
                  onClick={() => changePage(currentPage + 1)}
                >
                  Siguiente <ArrowRight size={21} />
                </button>
              </nav>
            ) : null}
          </div>
        </main>
        <aside
          className="restaurant-wide-order"
          aria-label="Resumen del pedido"
        >
          <header>
            <ShoppingBag size={25} />
            <h2>Tu pedido</h2>
            <span>{itemCount}</span>
          </header>
          <RestaurantOrder {...props} />
        </aside>
      </div>
      <footer className="restaurant-order-bar">
        <div>
          <span className="restaurant-order-count">{itemCount}</span>
          <div>
            <span>Subtotal del pedido</span>
            <strong>{formatMoney(subtotal)}</strong>
          </div>
        </div>
        <button
          type="button"
          disabled={cart.length === 0}
          onClick={() => setReviewOpen(true)}
        >
          Revisar pedido <ChevronRight size={24} />
        </button>
      </footer>
      {feedback ? (
        <p role="status" className="restaurant-feedback">
          {feedback}
        </p>
      ) : null}
      <dialog
        ref={dialogRef}
        className="restaurant-review-dialog"
        aria-labelledby="restaurant-review-title"
        onCancel={(event) => {
          event.preventDefault();
          setReviewOpen(false);
        }}
        onClose={() => setReviewOpen(false)}
        onClick={(event) => {
          if (event.target === event.currentTarget) setReviewOpen(false);
        }}
      >
        {reviewOpen ? (
          <div className="restaurant-review-content">
            <header>
              <div>
                <p className="restaurant-eyebrow">{serviceLabel}</p>
                <h2 id="restaurant-review-title">Revisa tu pedido</h2>
              </div>
              <button
                type="button"
                autoFocus
                aria-label="Volver al menú"
                onClick={() => setReviewOpen(false)}
              >
                <X size={25} />
              </button>
            </header>
            <RestaurantOrder {...props} />
            <button
              type="button"
              className="restaurant-back-to-menu"
              onClick={() => setReviewOpen(false)}
            >
              <ArrowLeft size={20} /> Seguir eligiendo
            </button>
          </div>
        ) : null}
      </dialog>
    </div>
  );
}
