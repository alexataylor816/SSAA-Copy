import { ImageIcon } from "lucide-react";

/**
 * Thumbnails for the photos attached to a schedule request, mirroring the
 * Lovable `ScheduleImageGallery`. Ours serves public `/uploads/*` paths, so
 * there is no signed-URL resolving step — render them directly.
 */
export default function ScheduleRequestPhotos({ imageUrls }: { imageUrls: string[] }) {
  if (imageUrls.length === 0) return null;

  return (
    <div className="space-y-1">
      <p className="text-xs font-medium flex items-center gap-1">
        <ImageIcon className="w-3 h-3" />
        Attached photos ({imageUrls.length})
      </p>
      <div className="flex flex-wrap gap-2">
        {imageUrls.map((url) => (
          <a
            key={url}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="block w-12 h-12 rounded-md overflow-hidden border border-border hover:border-primary transition-colors"
          >
            <img src={url} alt="Attached schedule photo" className="w-full h-full object-cover" loading="lazy" />
          </a>
        ))}
      </div>
    </div>
  );
}
