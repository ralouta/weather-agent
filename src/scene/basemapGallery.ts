import type Basemap from "@arcgis/core/Basemap.js";

export async function createBasemapGallerySource() {
  const [{ default: BasemapCtor }, { default: LocalBasemapsSource }] = await Promise.all([
    import("@arcgis/core/Basemap.js"),
    import("@arcgis/core/widgets/BasemapGallery/support/LocalBasemapsSource.js"),
  ]);

  const basemapIds = [
    "satellite",
    "hybrid",
    "topo-3d",
    "streets-navigation-vector",
    "dark-gray-vector",
  ];

  const basemaps = basemapIds
    .map((id) => BasemapCtor.fromId(id))
    .filter((basemap): basemap is Basemap => basemap !== null);

  return new LocalBasemapsSource({ basemaps });
}
