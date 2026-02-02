
from PIL import Image, ImagePalette
import math
import numpy as np

def generate_detailed_palette():
    # Extended "Turbo"-like palette to show more detail
    # Transparent -> Blue -> Cyan -> Green -> Yellow -> Red -> White
    # This reserves Red for only high density.
    points = [
        (0.0, 0, 0, 80),      # Dark Blue (Low)
        (0.15, 0, 0, 255),    # Blue
        (0.3, 0, 255, 255),   # Cyan (Medium-Low)
        (0.5, 0, 255, 0),     # Green (Medium)
        (0.7, 255, 255, 0),   # Yellow (High)
        (0.85, 255, 0, 0),    # Red (Very High)
        (1.0, 255, 255, 255)  # White (Extreme)
    ]
    
    palette = []
    for i in range(256):
        t = i / 255.0
        # Find segment
        for j in range(len(points) - 1):
            p1 = points[j]
            p2 = points[j+1]
            if p1[0] <= t <= p2[0]:
                # Interpolate
                local_t = (t - p1[0]) / (p2[0] - p1[0])
                r = int(p1[1] + (p2[1] - p1[1]) * local_t)
                g = int(p1[2] + (p2[2] - p1[2]) * local_t)
                b = int(p1[3] + (p2[3] - p1[3]) * local_t)
                palette.extend([r, g, b])
                break
    return palette

def convert_to_heatmap():
    path = r'd:/Reza Fauzan/Skunk Works 2/LEO Commercialization Planner/static/textures/gpw_v4_2020_per_pixel_population.tif'
    out_path = r'd:/Reza Fauzan/Skunk Works 2/LEO Commercialization Planner/static/textures/gpw_v4_density.png'
    
    print(f"Loading {path}...")
    try:
        img = Image.open(path)
    except Exception as e:
        print(f"Error opening image: {e}")
        return

    width, height = img.size
    print(f"Original Size: {width}x{height}, Mode: {img.mode}")
    
    pixels = img.load()
    
    # 1. Create a raw RGB image first (we resize later)
    # Actually, if we resize 'P' mode with Bicubic, it might not work well on indices.
    # Better to create high-res buffer or resize the float array?
    # Resizing the float array is best.
    
    # But for simplicity and speed:
    # Let's map to efficient indices first (Log scale) on original size.
    # Then resize the INDEX image? No, resizing indices creates intermediate values that might point to wrong colors.
    # Correct Way: Convert to RGBA, then Resize.
    
    valid_values = []
    for y in range(height):
        for x in range(width):
            val = pixels[x, y]
            if val > -9999 and not math.isnan(val) and val > 0:
                valid_values.append(val)
    
    if not valid_values:
        print("No valid data.")
        return
        
    min_val = min(valid_values)
    max_val = max(valid_values)
    log_min = math.log10(min_val)
    log_max = math.log10(max_val)
    scale = 1.0 / (log_max - log_min) if log_max > log_min else 1.0
    
    threshold_val = 1.0
    
    # Create RGBA image directly
    # To smooth it out, we'll upscale to 4K
    target_w, target_h = 4096, 2048
    
    # We will operate on the small image to create RGBA, then upscale RGBA.
    rgba_img = Image.new("RGBA", (width, height))
    rgba_pixels = rgba_img.load()
    
    palette_lookup = generate_detailed_palette() # Flat list [r,g,b, r,g,b...]
    # Convert to list of tuples for easier access
    palette_tuples = []
    for i in range(0, len(palette_lookup), 3):
        palette_tuples.append((palette_lookup[i], palette_lookup[i+1], palette_lookup[i+2]))
        
    for y in range(height):
        for x in range(width):
            val = pixels[x, y]
            
            if math.isnan(val) or val <= -9999 or val < threshold_val:
                rgba_pixels[x, y] = (0, 0, 0, 0) # Transparent
            else:
                log_val = math.log10(val)
                norm = (log_val - log_min) * scale
                # Clamp 0-1
                norm = max(0.0, min(1.0, norm))
                
                # Map to 0-255
                idx = int(norm * 255)
                r, g, b = palette_tuples[idx]
                rgba_pixels[x, y] = (r, g, b, 255) # Full opacity pixel
                
    # Now Resize to 4K for smoothness
    print("Upscaling to 4K...")
    # Resample=Image.BICUBIC for smoothing blocks
    high_res_img = rgba_img.resize((target_w, target_h), resample=Image.BICUBIC)
    
    high_res_img.save(out_path)
    print(f"Saved 4K detailed PNG to {out_path}")

if __name__ == "__main__":
    convert_to_heatmap()
