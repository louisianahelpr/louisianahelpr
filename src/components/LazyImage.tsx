import { useState, useEffect, useRef } from "react";

interface LazyImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  src: string;
  alt: string;
  fallback?: string;
}

const LazyImage = ({ src, alt, fallback = "/placeholder.svg", className, ...props }: LazyImageProps) => {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && imgRef.current) {
          imgRef.current.src = src;
          observer.disconnect();
        }
      },
      { rootMargin: "200px" }
    );

    if (imgRef.current) observer.observe(imgRef.current);
    return () => observer.disconnect();
  }, [src]);

  return (
    <img
      ref={imgRef}
      alt={alt}
      src={fallback}
      className={`transition-opacity duration-300 ${loaded ? "opacity-100" : "opacity-60"} ${className || ""}`}
      onLoad={() => setLoaded(true)}
      onError={() => {
        setError(true);
        if (imgRef.current) imgRef.current.src = fallback;
      }}
      loading="lazy"
      {...props}
    />
  );
};

export default LazyImage;
