import React from 'react';
import type { PromotionCreative } from '../../utils/promotionMedia';

type RestaurantPromotionBannerProps = {
  creative?: PromotionCreative | null;
  onSelect: (creative: PromotionCreative) => void;
};

const RestaurantPromotionBanner: React.FC<RestaurantPromotionBannerProps> = ({ creative, onSelect }) => {
  if (!creative) return null;
  return (
    <button
      type="button"
      onClick={() => onSelect(creative)}
      className="mb-5 flex min-h-[150px] w-full overflow-hidden rounded-3xl bg-orange-600 text-left text-white shadow-xl active:scale-[0.995]"
      aria-label={`Ver productos de ${creative.promotionName}`}
    >
      <div className="flex flex-1 flex-col justify-center p-6">
        <span className="text-xs font-black uppercase tracking-[0.2em] text-orange-100">Oferta destacada</span>
        <strong className="mt-2 text-3xl font-black">{creative.promotionName}</strong>
        <span className="mt-2 text-sm font-bold text-orange-100">Toca para ver {creative.productNames.slice(0, 2).join(' · ')}</span>
      </div>
      <img src={creative.media.url} alt={creative.promotionName} className="h-[150px] w-[42%] object-cover" />
    </button>
  );
};

export default RestaurantPromotionBanner;
