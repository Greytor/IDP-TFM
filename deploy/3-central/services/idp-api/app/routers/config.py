"""Configuración de arranque de la web app — público, sin token.

Por qué existe: la SPA no lleva su configuración compilada dentro. Si la llevara,
cada despliegue necesitaría su propia compilación, y eso rompe la regla de imagen
idéntica con configuración por instalación.

En esta edición del repositorio **no hay proveedor de identidad**: el sistema se
levanta y se usa sin login, porque lo que se demuestra es la arquitectura de datos
y no el control de acceso. Este endpoint devuelve por tanto solo lo que la app
necesita para pintarse: a dónde apunta Grafana, cómo se llama la instalación y en
qué huso horario está.
"""
from fastapi import APIRouter

from ..config import settings

router = APIRouter(prefix="/api/v1", tags=["config"])


@router.get("/config")
def app_config() -> dict:
    """Lo mínimo que la web app necesita para arrancar y mandarte al login."""
    return {
        # Dónde vive el Grafana que se embebe. Es su PROPIO dominio, no una ruta de
        # este: son dos audiencias distintas (demo público vs herramienta de venta)
        # y así Grafana conserva un único root_url. Ver ADR-022.
        "grafana_url": settings.grafana_url,
        "site_label": settings.site_label,
        # Huso de la planta: el selector de fechas de la web interpreta en esta
        # zona, igual que el PDF — así "de 06:00 a 14:00" es el turno de mañana
        # de la planta aunque el navegador esté en otro continente.
        "site_tz": settings.site_tz,
    }
