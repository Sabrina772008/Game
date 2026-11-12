// Avatar cosmetics catalog, shared by the server (prices, ownership checks)
// and the browser (drawing). Coins are earned in-game only and have no
// real-money value.

export const CATEGORIES = [
  { id: 'color', label: 'Colors' },
  { id: 'face', label: 'Faces' },
  { id: 'hair', label: 'Hairstyles' },
  { id: 'outfit', label: 'Outfits' },
  { id: 'accessory', label: 'Accessories' },
];

export const ITEMS = [
  // Body colors
  { id: 'c_sky', cat: 'color', name: 'Sky', price: 0, value: '#4cc9f0' },
  { id: 'c_lime', cat: 'color', name: 'Lime', price: 0, value: '#80ed99' },
  { id: 'c_sun', cat: 'color', name: 'Sunshine', price: 0, value: '#ffd60a' },
  { id: 'c_coral', cat: 'color', name: 'Coral', price: 0, value: '#ff7f6e' },
  { id: 'c_grape', cat: 'color', name: 'Grape', price: 40, value: '#9d4edd' },
  { id: 'c_bubblegum', cat: 'color', name: 'Bubblegum', price: 40, value: '#ff70a6' },
  { id: 'c_mint', cat: 'color', name: 'Mint', price: 40, value: '#64dfdf' },
  { id: 'c_tangerine', cat: 'color', name: 'Tangerine', price: 40, value: '#ff9f1c' },
  { id: 'c_midnight', cat: 'color', name: 'Midnight', price: 80, value: '#3a0ca3' },
  { id: 'c_gold', cat: 'color', name: 'Gold Rush', price: 150, value: '#e9b949' },

  // Faces
  { id: 'f_smile', cat: 'face', name: 'Smile', price: 0 },
  { id: 'f_happy', cat: 'face', name: 'Big Grin', price: 0 },
  { id: 'f_cool', cat: 'face', name: 'Cool Shades', price: 60 },
  { id: 'f_wink', cat: 'face', name: 'Wink', price: 30 },
  { id: 'f_surprised', cat: 'face', name: 'Surprised', price: 30 },
  { id: 'f_sleepy', cat: 'face', name: 'Sleepy', price: 30 },
  { id: 'f_star', cat: 'face', name: 'Star Eyes', price: 90 },

  // Hairstyles
  { id: 'h_none', cat: 'hair', name: 'None', price: 0 },
  { id: 'h_spiky', cat: 'hair', name: 'Spiky', price: 0 },
  { id: 'h_bob', cat: 'hair', name: 'Bob', price: 30 },
  { id: 'h_curly', cat: 'hair', name: 'Curly', price: 40 },
  { id: 'h_ponytail', cat: 'hair', name: 'Ponytail', price: 40 },
  { id: 'h_mohawk', cat: 'hair', name: 'Mohawk', price: 70 },
  { id: 'h_rainbow', cat: 'hair', name: 'Rainbow Puff', price: 160 },

  // Outfits
  { id: 'o_none', cat: 'outfit', name: 'None', price: 0 },
  { id: 'o_tee', cat: 'outfit', name: 'T-Shirt', price: 0, value: '#ffffff' },
  { id: 'o_hoodie', cat: 'outfit', name: 'Hoodie', price: 50, value: '#ef476f' },
  { id: 'o_space', cat: 'outfit', name: 'Space Suit', price: 90, value: '#e0e1dd' },
  { id: 'o_racer', cat: 'outfit', name: 'Racing Jacket', price: 90, value: '#06d6a0' },
  { id: 'o_tux', cat: 'outfit', name: 'Tuxedo', price: 140, value: '#22223b' },

  // Accessories
  { id: 'a_none', cat: 'accessory', name: 'None', price: 0 },
  { id: 'a_cap', cat: 'accessory', name: 'Cap', price: 0 },
  { id: 'a_bow', cat: 'accessory', name: 'Bow', price: 30 },
  { id: 'a_headphones', cat: 'accessory', name: 'Headphones', price: 60 },
  { id: 'a_crown', cat: 'accessory', name: 'Crown', price: 200 },
  { id: 'a_antenna', cat: 'accessory', name: 'Antenna', price: 50 },
  { id: 'a_flower', cat: 'accessory', name: 'Flower', price: 40 },
];

export const ITEM_BY_ID = Object.fromEntries(ITEMS.map((i) => [i.id, i]));

export const DEFAULT_AVATAR = {
  color: 'c_sky',
  face: 'f_smile',
  hair: 'h_spiky',
  outfit: 'o_tee',
  accessory: 'a_none',
};

export function freeItemIds() {
  return ITEMS.filter((i) => i.price === 0).map((i) => i.id);
}

/** Returns a clean avatar using only known items of the right category. */
export function sanitizeAvatar(avatar) {
  const out = { ...DEFAULT_AVATAR };
  if (!avatar || typeof avatar !== 'object') return out;
  for (const cat of Object.keys(DEFAULT_AVATAR)) {
    const item = ITEM_BY_ID[avatar[cat]];
    if (item && item.cat === cat) out[cat] = item.id;
  }
  return out;
}
