from typing import Optional, Any
from dataclasses import dataclass
from uuid import UUID
import json
import io
import base64

import pandas as pd
import numpy as np
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler, LabelEncoder
from sklearn.linear_model import LogisticRegression, LinearRegression
from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor
from sklearn.cluster import KMeans
from sklearn.metrics import (
    accuracy_score, f1_score, precision_score, recall_score,
    mean_squared_error, r2_score, silhouette_score,
    confusion_matrix,
)

try:
    import shap
    SHAP_AVAILABLE = True
except ImportError:
    SHAP_AVAILABLE = False

try:
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    MATPLOTLIB_AVAILABLE = True
except ImportError:
    MATPLOTLIB_AVAILABLE = False


@dataclass
class MLTrainingResult:
    metrics: dict[str, Any]
    artifacts: dict[str, Any]
    explainability: dict[str, Any]


class MLService:
    def __init__(self):
        self.supported_algorithms = {
            "CLASSIFICATION": ["logistic_regression", "random_forest"],
            "REGRESSION": ["linear_regression", "random_forest"],
            "CLUSTERING": ["kmeans"],
        }
    
    def parse_dataset(self, csv_content: str) -> tuple[pd.DataFrame, dict]:
        df = pd.read_csv(io.StringIO(csv_content))
        
        schema = {
            "columns": [],
            "num_rows": len(df),
            "num_cols": len(df.columns),
        }
        
        for col in df.columns:
            col_info = {
                "name": col,
                "dtype": str(df[col].dtype),
                "null_count": int(df[col].isnull().sum()),
                "unique_count": int(df[col].nunique()),
            }
            
            if df[col].dtype in ['int64', 'float64']:
                col_info["min"] = float(df[col].min())
                col_info["max"] = float(df[col].max())
                col_info["mean"] = float(df[col].mean())
            
            schema["columns"].append(col_info)
        
        return df, schema
    
    def get_preview(self, df: pd.DataFrame, n_rows: int = 10) -> dict:
        return {
            "columns": list(df.columns),
            "rows": df.head(n_rows).values.tolist(),
            "dtypes": {col: str(df[col].dtype) for col in df.columns},
        }
    
    async def train_classification(
        self,
        df: pd.DataFrame,
        target_column: str,
        algorithm: str = "random_forest",
        test_size: float = 0.2,
        config: dict = None,
    ) -> MLTrainingResult:
        config = config or {}
        
        X = df.drop(columns=[target_column])
        y = df[target_column]
        
        # Encode categorical features
        label_encoders = {}
        for col in X.select_dtypes(include=['object']).columns:
            le = LabelEncoder()
            X[col] = le.fit_transform(X[col].astype(str))
            label_encoders[col] = le
        
        # Encode target if categorical
        target_encoder = None
        if y.dtype == 'object':
            target_encoder = LabelEncoder()
            y = target_encoder.fit_transform(y)
        
        X_train, X_test, y_train, y_test = train_test_split(
            X, y, test_size=test_size, random_state=42
        )
        
        # Scale features
        scaler = StandardScaler()
        X_train_scaled = scaler.fit_transform(X_train)
        X_test_scaled = scaler.transform(X_test)
        
        # Train model
        if algorithm == "logistic_regression":
            model = LogisticRegression(max_iter=1000)
        else:
            model = RandomForestClassifier(
                n_estimators=config.get("n_estimators", 100),
                max_depth=config.get("max_depth", 10),
                random_state=42,
            )
        
        model.fit(X_train_scaled, y_train)
        y_pred = model.predict(X_test_scaled)
        
        # Calculate metrics
        metrics = {
            "accuracy": float(accuracy_score(y_test, y_pred)),
            "f1_score": float(f1_score(y_test, y_pred, average='weighted')),
            "precision": float(precision_score(y_test, y_pred, average='weighted')),
            "recall": float(recall_score(y_test, y_pred, average='weighted')),
        }
        
        # Generate artifacts
        artifacts = {}
        
        # Confusion matrix
        cm = confusion_matrix(y_test, y_pred)
        artifacts["confusion_matrix"] = cm.tolist()
        
        # Feature importance
        if hasattr(model, 'feature_importances_'):
            importance = dict(zip(X.columns, model.feature_importances_.tolist()))
            artifacts["feature_importance"] = importance
        
        # Generate explainability
        explainability = self._generate_classification_explanation(
            model, X, X_test_scaled, metrics, artifacts
        )
        
        return MLTrainingResult(
            metrics=metrics,
            artifacts=artifacts,
            explainability=explainability,
        )
    
    async def train_regression(
        self,
        df: pd.DataFrame,
        target_column: str,
        algorithm: str = "random_forest",
        test_size: float = 0.2,
        config: dict = None,
    ) -> MLTrainingResult:
        config = config or {}
        
        X = df.drop(columns=[target_column])
        y = df[target_column]
        
        # Encode categorical features
        for col in X.select_dtypes(include=['object']).columns:
            le = LabelEncoder()
            X[col] = le.fit_transform(X[col].astype(str))
        
        X_train, X_test, y_train, y_test = train_test_split(
            X, y, test_size=test_size, random_state=42
        )
        
        scaler = StandardScaler()
        X_train_scaled = scaler.fit_transform(X_train)
        X_test_scaled = scaler.transform(X_test)
        
        if algorithm == "linear_regression":
            model = LinearRegression()
        else:
            model = RandomForestRegressor(
                n_estimators=config.get("n_estimators", 100),
                max_depth=config.get("max_depth", 10),
                random_state=42,
            )
        
        model.fit(X_train_scaled, y_train)
        y_pred = model.predict(X_test_scaled)
        
        metrics = {
            "mse": float(mean_squared_error(y_test, y_pred)),
            "rmse": float(np.sqrt(mean_squared_error(y_test, y_pred))),
            "r2_score": float(r2_score(y_test, y_pred)),
        }
        
        artifacts = {}
        
        if hasattr(model, 'feature_importances_'):
            importance = dict(zip(X.columns, model.feature_importances_.tolist()))
            artifacts["feature_importance"] = importance
        elif hasattr(model, 'coef_'):
            importance = dict(zip(X.columns, np.abs(model.coef_).tolist()))
            artifacts["feature_importance"] = importance
        
        explainability = self._generate_regression_explanation(
            model, X, metrics, artifacts
        )
        
        return MLTrainingResult(
            metrics=metrics,
            artifacts=artifacts,
            explainability=explainability,
        )
    
    async def train_clustering(
        self,
        df: pd.DataFrame,
        n_clusters: int = 3,
        config: dict = None,
    ) -> MLTrainingResult:
        config = config or {}
        
        X = df.copy()
        
        # Encode categorical features
        for col in X.select_dtypes(include=['object']).columns:
            le = LabelEncoder()
            X[col] = le.fit_transform(X[col].astype(str))
        
        scaler = StandardScaler()
        X_scaled = scaler.fit_transform(X)
        
        model = KMeans(n_clusters=n_clusters, random_state=42, n_init=10)
        labels = model.fit_predict(X_scaled)
        
        metrics = {
            "n_clusters": n_clusters,
            "inertia": float(model.inertia_),
        }
        
        if len(set(labels)) > 1:
            metrics["silhouette_score"] = float(silhouette_score(X_scaled, labels))
        
        artifacts = {
            "cluster_centers": model.cluster_centers_.tolist(),
            "cluster_sizes": [int((labels == i).sum()) for i in range(n_clusters)],
        }
        
        explainability = self._generate_clustering_explanation(
            model, X, labels, metrics, artifacts
        )
        
        return MLTrainingResult(
            metrics=metrics,
            artifacts=artifacts,
            explainability=explainability,
        )
    
    def _generate_classification_explanation(
        self,
        model,
        X: pd.DataFrame,
        X_test_scaled,
        metrics: dict,
        artifacts: dict,
    ) -> dict:
        explanation = {
            "summary": f"Il modello di classificazione ha raggiunto un'accuratezza del {metrics['accuracy']*100:.1f}%.",
            "metrics_explanation": {
                "accuracy": "Percentuale di previsioni corrette sul totale.",
                "f1_score": "Media armonica di precisione e recall, utile per classi sbilanciate.",
                "precision": "Tra le previsioni positive, quante sono effettivamente corrette.",
                "recall": "Tra i casi positivi reali, quanti sono stati identificati.",
            },
        }
        
        if "feature_importance" in artifacts:
            top_features = sorted(
                artifacts["feature_importance"].items(),
                key=lambda x: x[1],
                reverse=True
            )[:5]
            explanation["top_features"] = [
                {"name": f[0], "importance": f[1]} for f in top_features
            ]
            explanation["feature_explanation"] = (
                f"Le caratteristiche più importanti per la previsione sono: "
                f"{', '.join([f[0] for f in top_features[:3]])}."
            )
        
        return explanation
    
    def _generate_regression_explanation(
        self,
        model,
        X: pd.DataFrame,
        metrics: dict,
        artifacts: dict,
    ) -> dict:
        explanation = {
            "summary": f"Il modello di regressione spiega il {metrics['r2_score']*100:.1f}% della varianza nei dati.",
            "metrics_explanation": {
                "mse": "Errore quadratico medio - misura la differenza media al quadrato tra valori previsti e reali.",
                "rmse": "Radice dell'errore quadratico medio - nella stessa unità di misura del target.",
                "r2_score": "Coefficiente di determinazione - quanto bene il modello spiega la variabilità dei dati.",
            },
        }
        
        if "feature_importance" in artifacts:
            top_features = sorted(
                artifacts["feature_importance"].items(),
                key=lambda x: x[1],
                reverse=True
            )[:5]
            explanation["top_features"] = [
                {"name": f[0], "importance": f[1]} for f in top_features
            ]
        
        return explanation
    
    def _generate_clustering_explanation(
        self,
        model,
        X: pd.DataFrame,
        labels,
        metrics: dict,
        artifacts: dict,
    ) -> dict:
        explanation = {
            "summary": f"I dati sono stati raggruppati in {metrics['n_clusters']} cluster.",
            "metrics_explanation": {
                "silhouette_score": "Misura quanto i punti sono simili al proprio cluster rispetto agli altri (-1 a 1, più alto è meglio).",
                "inertia": "Somma delle distanze al quadrato dal centro del cluster - più basso indica cluster più compatti.",
            },
            "cluster_summary": [],
        }
        
        for i, size in enumerate(artifacts["cluster_sizes"]):
            explanation["cluster_summary"].append({
                "cluster": i,
                "size": size,
                "percentage": f"{size/len(labels)*100:.1f}%",
            })
        
        return explanation


ml_service = MLService()
