import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { ImageIcon } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';

interface ScheduleImageGalleryProps {
  imageUrls: string[];
}

const resolveImageUrl = async (urlOrPath: string): Promise<string | null> => {
  if (urlOrPath.startsWith('http://') || urlOrPath.startsWith('https://')) {
    return urlOrPath;
  }
  const { data, error } = await supabase.storage
    .from('schedule-request-images')
    .createSignedUrl(urlOrPath, 3600);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
};

const ScheduleImageGallery = ({ imageUrls }: ScheduleImageGalleryProps) => {
  const { t } = useLanguage();
  const [resolvedUrls, setResolvedUrls] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    const resolve = async () => {
      const results = await Promise.all(imageUrls.map(resolveImageUrl));
      if (!cancelled) {
        setResolvedUrls(results.filter((u): u is string => u !== null));
      }
    };
    resolve();
    return () => { cancelled = true; };
  }, [imageUrls]);

  if (resolvedUrls.length === 0) return null;

  return (
    <div className="space-y-1">
      <p className="text-xs font-medium flex items-center gap-1">
        <ImageIcon className="w-3 h-3" />
        {t('schedule.attachedPhotos', { count: String(resolvedUrls.length) })}
      </p>
      <div className="flex flex-wrap gap-2">
        {resolvedUrls.map((url, idx) => (
          <a
            key={idx}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="block w-12 h-12 rounded-md overflow-hidden border border-border hover:border-primary transition-colors"
          >
            <img src={url} alt={`Photo ${idx + 1}`} className="w-full h-full object-cover" />
          </a>
        ))}
      </div>
    </div>
  );
};

export default ScheduleImageGallery;
export { resolveImageUrl };
