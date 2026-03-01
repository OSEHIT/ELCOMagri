# ELCOMagri - Radiographie de l'élevage français 🐄🐖🐑🐐

> **Visualisation de la dynamique et des spécialisations territoriales des productions animales en France (2010-2024)**

Ce projet a été réalisé dans un cadre académique pour explorer, analyser et visualiser les données de la Statistique Agricole Annuelle (SAA). L'objectif est de fournir un tableau de bord interactif permettant de comprendre les volumes de production et le nombre de têtes pour 4 grands groupes d'animaux (Bovins, Porcins, Ovins, Caprins) répartis en 19 catégories.

## 🚀 Fonctionnalités du Dashboard

* **Cartogramme à bulles (D3 Force) :** Visualisation spatiale des volumes de production par département. Taille des bulles proportionnelle à la production.
* **Donut Chart dynamique :** Répartition exacte (en pourcentages et en tonnes) des catégories pour l'année et/ou le département sélectionné.
* **Graphique en aires empilées (Stacked Area Chart) :** Analyse des tendances macroéconomiques de 2010 à 2024 avec un tracker temporel synchronisé.
* **Filtres croisés intelligents :** Sélection multiple (Opt-in) par groupes et catégories, avec mise à jour instantanée de tous les graphiques.

## 🛠️ Technologies Utilisées

* **HTML5 / CSS3** (Interface native, Flexbox, CSS Grid)
* **JavaScript (ES6)** (Logique d'état, filtrage des données)
* **D3.js (v7)** (Rendu SVG, échelles, layouts de force, stack, interactivité)

## 📊 Source des Données

Les données (environ 28 500 entrées) proviennent du Ministère de l'Agriculture et de la Souveraineté Alimentaire :
🔗 [Site Agreste - SAA Séries Longues](https://agreste.agriculture.gouv.fr/agreste-web/disaron/SAA-SeriesLongues/detail/)

