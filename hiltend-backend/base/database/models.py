import uuid
import enum
from datetime import datetime
from sqlalchemy import Column, String, DateTime, ForeignKey, Enum, Text
from sqlalchemy.orm import declarative_base, relationship

Base = declarative_base()

# --- Enums ---
class AccessRole(str, enum.Enum):
    VIEWER = "viewer"
    USER = "user"
    ADMIN = "admin"
    OWNER = "owner"

# --- Models ---
class AppUser(Base):
    __tablename__ = 'AppUser'
    
    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    azure_oid = Column(String(255), unique=True, nullable=False, index=True) # Matches the Entra ID token
    email = Column(String(255), unique=True, nullable=False)
    name = Column(String(255), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    owned_datasets = relationship("Dataset", back_populates="owner")
    dataset_access = relationship("DatasetAccess", back_populates="user", cascade="all, delete-orphan")


class Dataset(Base):
    __tablename__ = 'Dataset'
    
    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String(255), unique=True, nullable=False) # The actual SQL Schema name
    display_name = Column(String(255), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    created_by = Column(String(36), ForeignKey('AppUser.id'), nullable=False)

    # Relationships
    owner = relationship("AppUser", back_populates="owned_datasets")
    access_list = relationship("DatasetAccess", back_populates="dataset", cascade="all, delete-orphan")
    jobs = relationship("JobHistory", back_populates="dataset", cascade="all, delete-orphan")
    views = relationship("SavedView", back_populates="dataset", cascade="all, delete-orphan")


class DatasetAccess(Base):
    __tablename__ = 'DatasetAccess'
    
    user_id = Column(String(36), ForeignKey('AppUser.id'), primary_key=True)
    dataset_id = Column(String(36), ForeignKey('Dataset.id'), primary_key=True)
    role = Column(Enum(AccessRole), nullable=False, default=AccessRole.VIEWER)
    granted_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    user = relationship("AppUser", back_populates="dataset_access")
    dataset = relationship("Dataset", back_populates="access_list")


class JobHistory(Base):
    __tablename__ = 'JobHistory'
    
    id = Column(String(50), primary_key=True) # e.g., JOB-1234
    batch_id = Column(String(50), index=True)
    adls_file_id = Column(Text, nullable=True)
    timestamp = Column(DateTime, default=datetime.utcnow)
    overall_status = Column(String(50), nullable=False)
    steps_json = Column(Text, nullable=True)
    
    user_id = Column(String(36), ForeignKey('AppUser.id'), nullable=False)
    dataset_id = Column(String(36), ForeignKey('Dataset.id'), nullable=False)

    # Relationships
    dataset = relationship("Dataset", back_populates="jobs")
    user = relationship("AppUser")


class SavedView(Base):
    __tablename__ = 'SavedViews'
    
    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    view_name = Column(String(255), nullable=False)
    columns_json = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    dataset_id = Column(String(36), ForeignKey('Dataset.id'), nullable=False)
    created_by = Column(String(36), ForeignKey('AppUser.id'), nullable=False)

    # Relationships
    dataset = relationship("Dataset", back_populates="views")
    user = relationship("AppUser")